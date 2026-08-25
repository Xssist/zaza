// zaza-admin Cloudflare Worker
const GH_OWNER  = 'Xssist';
const GH_REPO   = 'zaza';
const GH_BRANCH = 'main';

const SESSIONS    = new Map();
const RATE_LIMITS = new Map();

async function sha256hex(msg) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function makeToken() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2,'0')).join('');
}

function corsHeaders(origin, env) {
  const allowed = env?.ADMIN_ORIGIN || '';
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
  if (origin && allowed && origin === allowed) headers['Access-Control-Allow-Origin'] = origin;
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
  if (RATE_LIMITS.size > 10000) RATE_LIMITS.clear();
  for (const [key, entry] of RATE_LIMITS.entries()) {
    if (now > entry.reset) {
      RATE_LIMITS.delete(key);
    }
  }
  const e   = RATE_LIMITS.get(ip) || { n: 0, reset: now + 300000 };
  if (now > e.reset) { e.n = 0; e.reset = now + 300000; }
  if (e.n >= 5) return false;
  e.n++;
  RATE_LIMITS.set(ip, e);
  return true;
}

function validSession(token) {
  if (!token || typeof token !== 'string' || token.length !== 64) return false;
  const s = SESSIONS.get(token);
  if (!s) return false;
  if (Date.now() > s.exp) { SESSIONS.delete(token); return false; }
  return true;
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

async function handleLogin(req, ip, env, origin) {
  if (!checkRate(ip)) return res({ ok:false, error:'Too many attempts — wait 5 minutes' }, 429, origin, env);
  let body; try { body = await readJson(req, 4096); } catch { return res({ ok:false, error:'Bad request' }, 400, origin, env); }
  if (!body || !isSafeData(body) || typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 256) return res({ ok:false, error:'Invalid credentials' }, 400, origin, env);
  const hash = await sha256hex(body.password);
  if (!env.PASS_HASH || hash !== env.PASS_HASH) return res({ ok:false, error:'Invalid credentials' }, 401, origin, env);
  const token = makeToken();
  SESSIONS.set(token, { exp: Date.now() + 3600000 });
  return res({ ok:true, token }, 200, origin, env);
}

async function handleSaveConfig(req, env, origin) {
  const sToken = req.headers.get('X-Session-Token');
  if (!validSession(sToken)) return res({ ok:false, error:'Unauthorized' }, 401, origin, env);

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

  // Debug: check if token is present
  const ghToken = env.GH_TOKEN;
  if (!ghToken) return res({ ok:false, error:'Service unavailable' }, 500, origin, env);

  const cfgStr = JSON.stringify(cfg, null, 2);
  const utf8Bytes = new TextEncoder().encode(cfgStr);
  let binaryStr = '';
  for (let i = 0; i < utf8Bytes.length; i++) {
    binaryStr += String.fromCharCode(utf8Bytes[i]);
  }
  const b64 = btoa(binaryStr);

  const ghH = {
    'Authorization': 'token ' + ghToken,
    'Accept':        'application/vnd.github.v3+json',
    'Content-Type':  'application/json',
    'User-Agent':    'zaza-admin-worker',
  };

  const getR = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/config.json`,
    { headers: ghH }
  );
  if (!getR.ok) {
    const errText = await getR.text();
    return res({ ok:false, error:`GitHub GET ${getR.status}: ${errText.slice(0,200)}` }, 502);
  }

  const { sha } = await getR.json();
  const putR = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/config.json`,
    {
      method: 'PUT', headers: ghH,
      body: JSON.stringify({ message:'chore: update config via admin', content:b64, sha, branch:GH_BRANCH }),
    }
  );
  if (!putR.ok) {
    const e = await putR.json().catch(() => ({ message: putR.statusText }));
    return res({ ok:false, error:e.message }, 502);
  }
  return res({ ok:true }, 200);
}

async function handleUpload(req, env, origin) {
  const sToken = req.headers.get('X-Session-Token');
  if (!validSession(sToken)) return res({ ok:false, error:'Unauthorized' }, 401, origin, env);

  let body; try { body = await readJson(req, 140 * 1024 * 1024); } catch { return res({ ok:false, error:'Bad request' }, 400, origin, env); }
  const ALLOWED = ['assets/images/avatar.png','assets/images/background.mp4','assets/music/song.mp3'];
  if (!body || typeof body !== 'object' || !ALLOWED.includes(body.path) || Object.keys(body).some(k => !['path','content'].includes(k))) return res({ ok:false, error:'Invalid upload' }, 400, origin, env);

  // Enforce 100MB decoded file limit (~133.4MB base64)
  if (typeof body.content !== 'string' || !body.content) {
    return res({ ok:false, error:'Missing file content' }, 400);
  }
  const maxBase64Length = Math.ceil(100 * 1024 * 1024 * 4 / 3);
  if (body.content.length % 4 !== 0 || body.content.length > maxBase64Length || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.content)) {
    return res({ ok:false, error:'File exceeds 100MB limit or has invalid encoding' }, 413);
  }

  const ghToken = env.GH_TOKEN;
  if (!ghToken) return res({ ok:false, error:'Service unavailable' }, 500, origin, env);

  const ghH = {
    'Authorization': 'token ' + ghToken,
    'Accept':        'application/vnd.github.v3+json',
    'Content-Type':  'application/json',
    'User-Agent':    'zaza-admin-worker',
  };

  let sha = null;
  try {
    const g = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${body.path}`, { headers:ghH });
    if (g.ok) sha = (await g.json()).sha;
  } catch (_) {}

  const rb = { message:`upload: ${body.path}`, content:body.content, branch:GH_BRANCH };
  if (sha) rb.sha = sha;

  const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${body.path}`, {
    method:'PUT', headers:ghH, body:JSON.stringify(rb)
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({ message:r.statusText }));
    return res({ ok:false, error:e.message }, 502);
  }
  return res({ ok:true }, 200);
}

function handleLogout(req, env, origin) {
  const t = req.headers.get('X-Session-Token');
  if (t) SESSIONS.delete(t);
  return res({ ok:true }, 200);
}

// Health check for admin panel "Test Connection" button
async function handleTest(req, env, origin) {
  const sToken = req.headers.get('X-Session-Token');
  if (!validSession(sToken)) return res({ ok:false, error:'Unauthorized' }, 401, origin, env);

  const ghToken = env.GH_TOKEN;
  if (!ghToken) return res({ ok:false, error:'Service unavailable' }, 500, origin, env);

  try {
    const r = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}`,
      { headers: { 'Authorization':'token '+ghToken, 'Accept':'application/vnd.github.v3+json', 'User-Agent':'zaza-admin-worker' } }
    );
    if (!r.ok) {
      const t = await r.text();
      return res({ ok:false, error:`GitHub ${r.status}: ${t.slice(0,160)}` }, 502);
    }
    const d = await r.json();
    return res({ ok:true, repo:d.full_name }, 200);
  } catch (e) {
    return res({ ok:false, error:'Network error: '+e.message }, 502);
  }
}

export default {
  async fetch(request, env) {
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const origin = request.headers.get('Origin') || '';
    const corsH = corsHeaders(origin, env);
    if (env.ADMIN_ORIGIN && origin !== env.ADMIN_ORIGIN) return new Response('Forbidden', { status:403, headers:corsH });
    if (request.method === 'OPTIONS') return new Response(null, { status:204, headers:corsH });
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
