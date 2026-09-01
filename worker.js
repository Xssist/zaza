// zaza-admin Cloudflare Worker
const GH_OWNER  = 'Xssist';
const GH_REPO   = 'zaza';
const GH_BRANCH = 'main';

const RATE_LIMITS = new Map();

async function sha256hex(msg) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// Tokens carry a secret epoch. Rotating the epoch (on logout-all / password change)
// instantly invalidates every token signed with the previous one.
let SECRET_EPOCH = null;

async function makeToken(env) {
  // Stateless signed session: Cloudflare can serve later requests from another isolate.
  if (!SECRET_EPOCH) SECRET_EPOCH = crypto.getRandomValues(new Uint8Array(16));
  const epoch = Array.from(SECRET_EPOCH, b => b.toString(16).padStart(2, '0')).join('');
  const exp = Date.now() + 3600000;
  const signature = await sha256hex(`${env.PASS_HASH}:${epoch}:${exp}`);
  return `${exp}.${signature}.${epoch}`;
}

function revokeAllTokens() { SECRET_EPOCH = null; }

/* Shared GitHub API helpers — used by save-config, upload and test handlers. */
function ghHeaders(env) {
  return {
    'Authorization': 'token ' + env.GH_TOKEN,
    'Accept':        'application/vnd.github.v3+json',
    'Content-Type':  'application/json',
    'User-Agent':    'zaza-admin-worker',
  };
}

/* Fetch a GitHub API endpoint; parses the body once and throws on non-2xx. */
async function ghApi(url, options = {}, ghH) {
  const r = await fetch(url, { ...options, headers: { ...ghH, ...(options.headers || {}) } });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text || r.statusText }; }
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${data.message || 'request failed'}`);
  return data;
}

function corsHeaders(origin, env) {
  // Keep the production site working even if ADMIN_ORIGIN was not configured;
  // deployments should still set ADMIN_ORIGIN explicitly for custom domains.
  const allowed = env?.ADMIN_ORIGIN;
  const allowedOrigins = new Set([allowed].filter(Boolean));
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
  if (origin && allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  else if (!origin && allowed) headers['Access-Control-Allow-Origin'] = allowed;
  return headers;
}

function res(data, status, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin, env),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function checkRate(ip) {
  const now = Date.now();
  // Evict only expired entries — a blanket clear() would let an attacker
  // reset everyone's counters by inflating the map.
  for (const [key, entry] of RATE_LIMITS.entries()) {
    if (now > entry.reset) {
      RATE_LIMITS.delete(key);
    }
  }
  if (RATE_LIMITS.size > 10000) return false; // hard cap under memory pressure — fail closed
  const e   = RATE_LIMITS.get(ip) || { n: 0, reset: now + 300000 };
  if (now > e.reset) { e.n = 0; e.reset = now + 300000; }
  if (e.n >= 5) return false;
  e.n++;
  RATE_LIMITS.set(ip, e);
  return true;
}

async function validSession(token, env) {
  if (typeof token !== 'string' || token.length > 200) return false;
  const firstDot = token.indexOf('.');
  const lastDot = token.lastIndexOf('.');
  if (firstDot < 1 || lastDot <= firstDot) return false;
  const exp = Number(token.slice(0, firstDot));
  const signature = token.slice(firstDot + 1, lastDot);
  const epoch = token.slice(lastDot + 1);
  if (!Number.isSafeInteger(exp) || exp <= Date.now() || !/^[a-f0-9]{64}$/.test(signature) || !/^[a-f0-9]{32}$/.test(epoch) || !env?.PASS_HASH) return false;
  if (SECRET_EPOCH && epoch !== Array.from(SECRET_EPOCH, b => b.toString(16).padStart(2, '0')).join('')) return false; // epoch rotated — token revoked
  const expected = await sha256hex(`${env.PASS_HASH}:${epoch}:${exp}`);
  let mismatch = signature.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

// The project currently has no SQL database. Keep incoming JSON strictly data-only
// so future persistence code cannot accidentally accept prototype-pollution payloads.
function isSafeData(value, depth = 0) {
  if (depth > 8 || value === null) return true;
  if (typeof value === 'string') return value.length <= 2000;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length <= 500 && value.every(v => isSafeData(v, depth + 1));
  if (typeof value !== 'object') return false;
  return Object.keys(value).length <= 100 && Object.entries(value).every(([key, v]) =>
    !['__proto__', 'prototype', 'constructor'].includes(key) && isSafeData(v, depth + 1)
  );
}

async function readJson(req, maxBytes = 250000) {
  const length = Number(req.headers.get('Content-Length') || 0);
  if (length && length > maxBytes) throw new Error('request-too-large');
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new Error('request-too-large');
  return JSON.parse(text);
}

// Length-independent comparison that always walks the full string.
function constantTimeEqual(a, b) {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < len; i++) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}

async function handleLogin(req, ip, env, origin) {
  if (!checkRate(ip)) return res({ ok:false, error:'Too many attempts — wait 5 minutes' }, 429, origin, env);
  let body; try { body = await readJson(req, 4096); } catch { return res({ ok:false, error:'Bad request' }, 400, origin, env); }
  if (!body || !isSafeData(body) || typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 256) return res({ ok:false, error:'Invalid credentials' }, 400, origin, env);
  const hash = await sha256hex(body.password);
  if (!env.PASS_HASH || !constantTimeEqual(hash, env.PASS_HASH)) return res({ ok:false, error:'Invalid credentials' }, 401, origin, env);
  const token = await makeToken(env);
  return res({ ok:true, token }, 200, origin, env);
}

async function handleSaveConfig(req, env, origin) {
  const sToken = req.headers.get('X-Session-Token');
  if (!(await validSession(sToken, env))) return res({ ok:false, error:'Unauthorized' }, 401, origin, env);

  let body; try { body = await readJson(req); } catch { return res({ ok:false, error:'Bad request' }, 400, origin, env); }
  const cfg = body?.config;
  if (!isSafeData(body) || !cfg || typeof cfg !== 'object' || Array.isArray(cfg) || JSON.stringify(cfg).length > 200000) return res({ ok:false, error:'Invalid config' }, 400, origin, env);
  if (cfg.admin && typeof cfg.admin === 'object') delete cfg.admin.passwordHash;
  if (cfg.spotify && typeof cfg.spotify === 'object') {
    delete cfg.spotify.accessToken;
    delete cfg.spotify.refreshToken;
    delete cfg.spotify.clientId;
    delete cfg.spotify.clientSecret;
  }

  const ghToken = env.GH_TOKEN;
  if (!ghToken) return res({ ok:false, error:'Service unavailable' }, 500, origin, env);

  const cfgStr = JSON.stringify(cfg, null, 2);
  const utf8Bytes = new TextEncoder().encode(cfgStr);
  let binaryStr = '';
  for (let i = 0; i < utf8Bytes.length; i++) {
    binaryStr += String.fromCharCode(utf8Bytes[i]);
  }
  const b64 = btoa(binaryStr);

  const ghH = ghHeaders(env);
  let getResp;
  try { getResp = await ghApi(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/config.json`, {}, ghH); }
  catch (e) { return res({ ok:false, error:`GitHub GET: ${String(e.message).slice(0,200)}` }, 502, origin, env); }
  const { sha } = getResp;
  try {
    await ghApi(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/config.json`, {
      method:'PUT', body: JSON.stringify({ message:'chore: update config via admin', content:b64, sha, branch:GH_BRANCH }),
    }, ghH);
  } catch (e) {
    // A second save between our GET and PUT invalidates the sha (409). Re-read
    // the latest sha once and retry so a race doesn't surface as an error.
    if (!String(e.message).startsWith('GitHub 409')) {
      return res({ ok:false, error:String(e.message).slice(0,200) }, 502, origin, env);
    }
    let retrySha;
    try { retrySha = (await ghApi(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/config.json`, {}, ghH)).sha; }
    catch { return res({ ok:false, error:'Save conflict — retry' }, 409, origin, env); }
    try {
      await ghApi(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/config.json`, {
        method:'PUT', body: JSON.stringify({ message:'chore: update config via admin', content:b64, sha:retrySha, branch:GH_BRANCH }),
      }, ghH);
    } catch (e2) {
      return res({ ok:false, error:String(e2.message).slice(0,200) }, 502, origin, env);
    }
  }
  return res({ ok:true }, 200, origin, env);
}

async function handleUpload(req, env, origin) {
  const sToken = req.headers.get('X-Session-Token');
  if (!(await validSession(sToken, env))) return res({ ok:false, error:'Unauthorized' }, 401, origin, env);
  let body; try { body = await readJson(req, 120 * 1024 * 1024); } catch { return res({ ok:false, error:'Bad request' }, 400, origin, env); }
  const ALLOWED = ['assets/images/avatar.png','assets/images/background.mp4','assets/music/song.mp3'];
  if (!body || typeof body !== 'object' || !ALLOWED.includes(body.path) || Object.keys(body).some(k => !['path','content'].includes(k))) return res({ ok:false, error:'Invalid upload' }, 400, origin, env);
  if (typeof body.content !== 'string' || !body.content || body.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.content)) return res({ ok:false, error:'Invalid file encoding' }, 400, origin, env);
  const maxBase64Length = Math.ceil(100 * 1024 * 1024 * 4 / 3);
  if (body.content.length > maxBase64Length) return res({ ok:false, error:'File exceeds the 100MB limit' }, 413, origin, env);
  const ghToken = env.GH_TOKEN;
  if (!ghToken) return res({ ok:false, error:'Service unavailable' }, 500, origin, env);
  const ghH = ghHeaders(env);
  try {
    // The Contents API rejects large binary updates with "file too large".
    // The Git Data API stores the blob first, then creates a normal commit.
    const blob = await ghApi(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/git/blobs`, {method:'POST',body:JSON.stringify({content:body.content,encoding:'base64'})}, ghH);
    const ref = await ghApi(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/git/ref/heads/${GH_BRANCH}`, {}, ghH);
    const baseCommit = await ghApi(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/git/commits/${ref.object.sha}`, {}, ghH);
    const tree = await ghApi(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/git/trees`, {method:'POST',body:JSON.stringify({base_tree:baseCommit.tree.sha,tree:[{path:body.path,mode:'100644',type:'blob',sha:blob.sha}]})}, ghH);
    const commit = await ghApi(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/git/commits`, {method:'POST',body:JSON.stringify({message:`upload: ${body.path}`,tree:tree.sha,parents:[ref.object.sha]})}, ghH);
    await ghApi(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/git/refs/heads/${GH_BRANCH}`, {method:'PATCH',body:JSON.stringify({sha:commit.sha,force:false})}, ghH);
    return res({ok:true},200,origin,env);
  } catch (e) { return res({ok:false,error:e.message||'Upload failed'},502,origin,env); }
}

function handleLogout(req, env, origin) {
  // Tokens are stateless, so we rotate the signing epoch instead of deleting
  // from a map — this revokes every currently-issued token immediately.
  revokeAllTokens();
  return res({ ok:true }, 200, origin, env);
}

// Health check for admin panel "Test Connection" button
async function handleTest(req, env, origin) {
  const sToken = req.headers.get('X-Session-Token');
  if (!(await validSession(sToken, env))) return res({ ok:false, error:'Unauthorized' }, 401, origin, env);

  const ghToken = env.GH_TOKEN;
  if (!ghToken) return res({ ok:false, error:'Service unavailable' }, 500, origin, env);

  try {
    const d = await ghApi(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}`, {}, ghHeaders(env));
    return res({ ok:true, repo:d.full_name }, 200, origin, env);
  } catch (e) {
    return res({ ok:false, error:'Network error: '+e.message }, 502, origin, env);
  }
}

export default {
  async fetch(request, env) {
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const origin = request.headers.get('Origin') || '';
    const corsH = corsHeaders(origin, env);
    const allowedRequestOrigins = new Set([env.ADMIN_ORIGIN].filter(Boolean));
    if (origin && !allowedRequestOrigins.has(origin)) return new Response('Forbidden', { status:403, headers:corsH });
    if (request.method === 'OPTIONS') return new Response(null, { status:204, headers:corsH });
    if (request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return new Response('Unsupported media type', { status:415, headers:corsH });
    if (request.method !== 'POST') return new Response('Method not allowed', { status:405, headers:corsH });
    const path = new URL(request.url).pathname;
    try {
      switch (path) {
        case '/login':       return await handleLogin(request, ip, env, origin);
        case '/save-config': return await handleSaveConfig(request, env, origin);
        case '/upload':      return await handleUpload(request, env, origin);
        case '/test':        return await handleTest(request, env, origin);
        case '/logout':      return handleLogout(request, env, origin);
        default:             return new Response('Not found', { status:404, headers:corsH });
      }
    } catch(err) {
      return res({ ok:false, error:'Internal error' }, 500, origin, env);
    }
  },
};
