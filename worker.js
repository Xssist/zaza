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

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token',
  };
}

function res(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

function checkRate(ip) {
  const now = Date.now();
  const e   = RATE_LIMITS.get(ip) || { n: 0, reset: now + 300000 };
  if (now > e.reset) { e.n = 0; e.reset = now + 300000; }
  if (e.n >= 5) return false;
  e.n++;
  RATE_LIMITS.set(ip, e);
  return true;
}

function validSession(token) {
  if (!token) return false;
  const s = SESSIONS.get(token);
  if (!s) return false;
  if (Date.now() > s.exp) { SESSIONS.delete(token); return false; }
  return true;
}

async function handleLogin(req, ip, env) {
  if (!checkRate(ip)) return res({ ok:false, error:'Too many attempts — wait 5 minutes' }, 429);
  let body; try { body = await req.json(); } catch { return res({ ok:false, error:'Bad request' }, 400); }
  const hash = await sha256hex(body.password || '');
  if (hash !== env.PASS_HASH) return res({ ok:false, error:'Invalid password' }, 401);
  const token = makeToken();
  SESSIONS.set(token, { exp: Date.now() + 3600000 });
  return res({ ok:true, token }, 200);
}

async function handleSaveConfig(req, env) {
  const sToken = req.headers.get('X-Session-Token');
  if (!validSession(sToken)) return res({ ok:false, error:'Unauthorized' }, 401);

  let body; try { body = await req.json(); } catch { return res({ ok:false, error:'Bad request' }, 400); }
  const cfg = body.config;
  if (!cfg || typeof cfg !== 'object') return res({ ok:false, error:'Invalid config' }, 400);
  if (cfg.admin) delete cfg.admin.passwordHash;

  // Debug: check if token is present
  const ghToken = env.GH_TOKEN;
  if (!ghToken) return res({ ok:false, error:'GH_TOKEN secret not set in Worker env' }, 500);

  const cfgStr = JSON.stringify(cfg, null, 2);
  const b64    = btoa(unescape(encodeURIComponent(cfgStr)));

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

async function handleUpload(req, env) {
  const sToken = req.headers.get('X-Session-Token');
  if (!validSession(sToken)) return res({ ok:false, error:'Unauthorized' }, 401);

  let body; try { body = await req.json(); } catch { return res({ ok:false, error:'Bad request' }, 400); }
  const ALLOWED = ['assets/images/avatar.png','assets/images/background.mp4','assets/music/song.mp3'];
  if (!ALLOWED.includes(body.path)) return res({ ok:false, error:'Path not allowed' }, 403);

  const ghToken = env.GH_TOKEN;
  if (!ghToken) return res({ ok:false, error:'GH_TOKEN secret not set' }, 500);

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

function handleLogout(req) {
  const t = req.headers.get('X-Session-Token');
  if (t) SESSIONS.delete(t);
  return res({ ok:true }, 200);
}

export default {
  async fetch(request, env) {
    const ip   = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const corsH = corsHeaders();

    if (request.method === 'OPTIONS') return new Response(null, { status:204, headers:corsH });
    if (request.method !== 'POST')    return new Response('Method not allowed', { status:405, headers:corsH });

    const path = new URL(request.url).pathname;
    try {
      switch (path) {
        case '/login':       return await handleLogin(request, ip, env);
        case '/save-config': return await handleSaveConfig(request, env);
        case '/upload':      return await handleUpload(request, env);
        case '/logout':      return handleLogout(request);
        default:             return new Response('Not found', { status:404, headers:corsH });
      }
    } catch(err) {
      return res({ ok:false, error:'Internal error: '+err.message }, 500);
    }
  },
};
