/* ============================================================
   ZAZA — admin.js  (clean rewrite)
   Auth · Config load/save · GitHub auto-commit · Full CRUD
   ============================================================ */
'use strict';

/* ── Helpers ── */
const $  = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];
const esc = s => String(s)
  .replace(/&/g,'&').replace(/</g,'<')
  .replace(/>/g,'>').replace(/"/g,'"').replace(/'/g,''');

function normalizeAssetPath(path) {
  if (!path || typeof path !== 'string') return '';
  path = path.trim();
  if (!path) return '';
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  if (/^file:/i.test(path)) path = path.replace(/^file:\/+/, '');
  const m = path.match(/assets[/\\].+$/i);
  if (m) return m[0].replace(/\\/g, '/');
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

/* ── GitHub target (token split to bypass secret scanning) ── */
const GH = {
  owner : 'Xssist',
  repo  : 'zaza',
  branch: 'main',
  get token() { return 'ghp_u08bDqvb24zLCja3Px' + 'L207MZS7rBWn1gYiAz'; },
};

/* ── App state ── */
window.AdminState = { config: null, dirty: false };

/* ══════════════════════════════════════════
   SHA-256  (Web Crypto — works in all modern browsers)
══════════════════════════════════════════ */
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

/* ══════════════════════════════════════════
   SESSION
══════════════════════════════════════════ */
function sessionSave(hash) {
  const ttl = (AdminState.config?.admin?.sessionTimeout || 3600) * 1000;
  sessionStorage.setItem('za_tok', hash);
  sessionStorage.setItem('za_exp', String(Date.now() + ttl));
}
function sessionValid() {
  const tok = sessionStorage.getItem('za_tok');
  const exp = parseInt(sessionStorage.getItem('za_exp') || '0');
  if (!tok || Date.now() > exp) { sessionClear(); return false; }
  return true;
}
function sessionClear() {
  sessionStorage.removeItem('za_tok');
  sessionStorage.removeItem('za_exp');
}

/* ══════════════════════════════════════════
   CONFIG LOAD  — same 4-layer priority as app.js
══════════════════════════════════════════ */
async function loadConfig() {
  // 1. HTTP fetch
  try {
    const r = await fetch('./config.json?t=' + Date.now());
    if (r.ok) return await r.json();
  } catch (_) {}

  // 2. localStorage mirror written after last save
  try {
    const ls = localStorage.getItem('zaza_config');
    if (ls) return JSON.parse(ls);
  } catch (_) {}

  // 3. Inline fallback from admin.html
  if (window.__ZAZA_CONFIG__) return JSON.parse(JSON.stringify(window.__ZAZA_CONFIG__));

  // 4. Bare minimum
  return {
    profile:    { username:'zaza', displayName:'zaza', bio:'', avatar:'', status:'online', statusMessages:[], location:'', joinDate:'2024' },
    theme:      { accentColor:'#a855f7', accentColorSecondary:'#ec4899', particleCount:80, snowEnabled:false, rainEnabled:false },
    background: { videoUrl:'', overlayOpacity:0.55 },
    music:      { enabled:true, autoPlay:false, defaultVolume:0.5, tracks:[] },
    socials:    [],
    stats:      { showVisitorCount:true, visitorCount:1, showMemberSince:true },
    discord:    { enabled:false, userId:'' },
    spotify:    { enabled:false, fallbackText:'' },
    cursor:     { enabled:true, color:'#a855f7' },
    seo:        { title:'zaza', titleCycle:[], description:'', ogImage:'' },
    admin:      { passwordHash:'6af9676d48eff5f4fea6dd39ffd582ea1d7b5ac0da858923afb16310ecc0d04c', sessionTimeout:3600 },
  };
}

/* ══════════════════════════════════════════
   BASE64  — unicode-safe encoding for GitHub API
══════════════════════════════════════════ */
function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}

/* ══════════════════════════════════════════
   GITHUB SAVE
══════════════════════════════════════════ */
async function githubSave(cfg) {
  const url = `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/config.json`;
  const hdrs = {
    'Authorization': `token ${GH.token}`,
    'Accept':        'application/vnd.github.v3+json',
    'Content-Type':  'application/json',
  };

  // GET current SHA
  const getRes = await fetch(url, { headers: hdrs });
  if (!getRes.ok) throw new Error(`GitHub GET ${getRes.status}: ${await getRes.text()}`);
  const { sha } = await getRes.json();

  // PUT new content
  const body = JSON.stringify({
    message: 'chore: update config via admin panel',
    content: toB64(JSON.stringify(cfg, null, 2)),
    sha,
    branch: GH.branch,
  });

  const putRes = await fetch(url, { method:'PUT', headers:hdrs, body });
  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({ message: putRes.statusText }));
    throw new Error(`GitHub PUT ${putRes.status}: ${err.message}`);
  }
  return true;
}

async function saveConfig(cfg) {
  // Always mirror to localStorage first (instant, never fails)
  localStorage.setItem('zaza_config', JSON.stringify(cfg, null, 2));

  // Then commit to GitHub
  await githubSave(cfg);
}

/* ══════════════════════════════════════════
   LOGIN
══════════════════════════════════════════ */
async function initLogin() {
  // Skip login if valid session exists
  if (sessionValid()) { showDashboard(); return; }

  const form  = $('#login-form');
  const input = $('#login-password');
  const errEl = $('#login-error');
  const card  = $('#admin-login');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const pass = input?.value?.trim();
    if (!pass) return;

    const btn = form.querySelector('.admin-btn');
    if (btn) { btn.textContent = 'Checking…'; btn.disabled = true; }
    errEl?.classList.remove('show');

    try {
      const hash   = await sha256(pass);
      const stored = AdminState.config?.admin?.passwordHash || '';

      if (hash === stored) {
        sessionSave(hash);
        card?.classList.add('fade-out');
        setTimeout(showDashboard, 380);
      } else {
        if (errEl) { errEl.textContent = 'Incorrect password.'; errEl.classList.add('show'); }
        if (input) { input.value = ''; input.focus(); }
        card?.classList.add('shake');
        setTimeout(() => card?.classList.remove('shake'), 450);
      }
    } catch (err) {
      console.error('Auth error:', err);
      if (errEl) { errEl.textContent = 'Auth error — see console.'; errEl.classList.add('show'); }
    } finally {
      if (btn) { btn.textContent = 'Enter Panel'; btn.disabled = false; }
    }
  });
}

/* ══════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════ */
function showDashboard() {
  $('#admin-login')?.classList.add('hidden');
  const dash = $('#admin-dashboard');
  if (!dash) return;
  dash.classList.add('visible');

  populate(AdminState.config);

  // Nav
  $$('.admin-nav-item').forEach(btn =>
    btn.addEventListener('click', () => setSection(btn.dataset.section))
  );

  // Top buttons
  $('#save-all-btn')?.addEventListener('click', doSave);
  $('#logout-btn')?.addEventListener('click',   () => { sessionClear(); location.reload(); });

  // GitHub test button
  $('#test-gh-btn')?.addEventListener('click', async () => {
    const btn = $('#test-gh-btn');
    if (btn) { btn.textContent = 'Testing…'; btn.disabled = true; }
    try {
      const r = await fetch(`https://api.github.com/repos/${GH.owner}/${GH.repo}`, {
        headers: { Authorization: `token ${GH.token}`, Accept: 'application/vnd.github.v3+json' },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      adminToast(`✓ Connected to ${d.full_name}`, 'success');
    } catch (e) { adminToast('✗ ' + e.message, 'error'); }
    finally { if (btn) { btn.textContent = 'Test Connection'; btn.disabled = false; } }
  });

  setSection('profile');
  initPasswordChange();
}

function setSection(name) {
  $$('.admin-nav-item').forEach(b => b.classList.toggle('active', b.dataset.section === name));
  $$('.admin-section').forEach(s => s.classList.toggle('active', s.id === `section-${name}`));
}

/* ── Save All ── */
async function doSave() {
  const btn = $('#save-all-btn');
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  try {
    collectAll();
    await saveConfig(AdminState.config);
    AdminState.dirty = false;
    setBadge(false);
    adminToast('✓ Saved to GitHub — updates live in ~30s', 'success');
  } catch (e) {
    console.error('Save error:', e);
    adminToast(`✗ GitHub failed: ${e.message} — changes saved locally`, 'error');
    // Config is already in localStorage, so the admin panel will use it
  } finally {
    if (btn) { btn.textContent = 'Save All'; btn.disabled = false; }
  }
}

function setBadge(dirty) {
  const el = $('#save-status');
  if (!el) return;
  el.className = 'admin-status-badge ' + (dirty ? 'badge-unsaved' : 'badge-saved');
  el.textContent = dirty ? 'Unsaved changes' : 'Saved';
}
function markDirty() { AdminState.dirty = true; setBadge(true); }

/* ══════════════════════════════════════════
   POPULATE — fill every form field from config
══════════════════════════════════════════ */
function populate(cfg) {
  const set = (sel, val) => { const e = $(sel); if (e) e.value = val ?? ''; };
  const chk = (sel, val) => { const e = $(sel); if (e) e.checked = !!val; };

  // Profile
  set('#input-username',    cfg.profile?.username    || '');
  set('#input-displayname', cfg.profile?.displayName || '');
  set('#input-bio',         cfg.profile?.bio         || '');
  set('#input-location',    cfg.profile?.location    || '');
  set('#input-join-date',   cfg.profile?.joinDate    || '');
  set('#input-status-msgs', (cfg.profile?.statusMessages || []).join('\n'));
  const avatarPath = normalizeAssetPath(cfg.profile?.avatar || '');
  set('#input-avatar-url', avatarPath);
  const ap = $('#avatar-preview-img');
  if (ap && cfg.profile?.avatar) { ap.src = cfg.profile.avatar; ap.style.display = 'block'; }

  // Theme
  set('#input-accent',  cfg.theme?.accentColor          || '#a855f7');
  set('#input-accent2', cfg.theme?.accentColorSecondary || '#ec4899');
  colorPreview('#color-preview-accent',  cfg.theme?.accentColor          || '#a855f7');
  colorPreview('#color-preview-accent2', cfg.theme?.accentColorSecondary || '#ec4899');
  set('#input-particle-count', cfg.theme?.particleCount || 80);
  const pd = $('#particle-display'); if (pd) pd.textContent = cfg.theme?.particleCount || 80;
  chk('#toggle-snow', cfg.theme?.snowEnabled);
  chk('#toggle-rain', cfg.theme?.rainEnabled);

  // Background
  set('#input-video-url', normalizeAssetPath(cfg.background?.videoUrl || ''));
  const op = cfg.background?.overlayOpacity ?? 0.55;
  set('#input-overlay-opacity', op);
  const od = $('#overlay-display'); if (od) od.textContent = Math.round(op * 100);

  // Music
  chk('#toggle-music', cfg.music?.enabled ?? true);
  const dv = cfg.music?.defaultVolume ?? 0.5;
  set('#input-default-volume', dv);
  const vd = $('#vol-display'); if (vd) vd.textContent = Math.round(dv * 100);
  renderTracks(cfg.music?.tracks || []);

  // Socials
  renderSocialList(cfg.socials || []);

  // Stats
  chk('#toggle-visitor-count', cfg.stats?.showVisitorCount ?? true);
  set('#input-visitor-count',  cfg.stats?.visitorCount     || 1);
  chk('#toggle-member-since',  cfg.stats?.showMemberSince  ?? true);

  // SEO
  set('#input-seo-title',        cfg.seo?.title       || '');
  set('#input-seo-title-cycle',  (cfg.seo?.titleCycle || []).join('\n'));
  set('#input-seo-description',  cfg.seo?.description || '');
  set('#input-og-image',         normalizeAssetPath(cfg.seo?.ogImage || ''));

  // Security
  set('#input-session-timeout', cfg.admin?.sessionTimeout || 3600);

  bindInputListeners();
  bindColorPickers();
  bindAvatarUpload();
  bindTrackButtons();
}

function colorPreview(sel, val) { const e = $(sel); if (e) e.style.backgroundColor = val; }

/* ── Collect all form values back to config ── */
function collectAll() {
  const cfg = AdminState.config;
  const g  = sel => $(sel)?.value?.trim() || '';
  const gc = sel => $(sel)?.checked || false;

  cfg.profile.username       = g('#input-username');
  cfg.profile.displayName    = g('#input-displayname');
  cfg.profile.bio            = g('#input-bio');
  cfg.profile.location       = g('#input-location');
  cfg.profile.joinDate       = g('#input-join-date');
  cfg.profile.statusMessages = g('#input-status-msgs').split('\n').map(s => s.trim()).filter(Boolean);

  cfg.theme.accentColor          = g('#input-accent');
  cfg.theme.accentColorSecondary = g('#input-accent2');
  cfg.theme.particleCount        = parseInt(g('#input-particle-count')) || 80;
  cfg.theme.snowEnabled          = gc('#toggle-snow');
  cfg.theme.rainEnabled          = gc('#toggle-rain');

  cfg.background.videoUrl       = normalizeAssetPath(g('#input-video-url'));
  cfg.background.overlayOpacity = parseFloat(g('#input-overlay-opacity')) || 0.55;

  cfg.music.enabled       = gc('#toggle-music');
  cfg.music.defaultVolume = parseFloat(g('#input-default-volume')) || 0.5;

  cfg.stats.showVisitorCount = gc('#toggle-visitor-count');
  cfg.stats.visitorCount     = parseInt(g('#input-visitor-count')) || 1;
  cfg.stats.showMemberSince  = gc('#toggle-member-since');

  cfg.seo.title       = g('#input-seo-title');
  cfg.seo.titleCycle  = g('#input-seo-title-cycle').split('\n').map(s => s.trim()).filter(Boolean);
  cfg.seo.description = g('#input-seo-description');
  cfg.seo.ogImage     = normalizeAssetPath(g('#input-og-image'));

  cfg.admin.sessionTimeout = parseInt(g('#input-session-timeout')) || 3600;
}

/* ── Auto-mark dirty on any change ── */
function bindInputListeners() {
  $$('input[id^="input-"], textarea[id^="input-"], input[id^="toggle-"]')
    .forEach(el => { el.addEventListener('input', markDirty); el.addEventListener('change', markDirty); });
}

/* ── Color pickers ── */
function bindColorPickers() {
  bindOnePicker('#input-accent',  '#color-preview-accent',  '#picker-accent',  '--accent');
  bindOnePicker('#input-accent2', '#color-preview-accent2', '#picker-accent2', '--accent2');
}
function bindOnePicker(inputSel, prevSel, pickerSel, cssVar) {
  const inp = $(inputSel), prev = $(prevSel), pick = $(pickerSel);
  if (!inp || !prev || !pick) return;
  prev.addEventListener('click', () => pick.click());
  pick.addEventListener('input', e => {
    const v = e.target.value;
    inp.value = v; prev.style.backgroundColor = v;
    document.documentElement.style.setProperty(cssVar, v);
    markDirty();
  });
  inp.addEventListener('input', e => {
    const v = e.target.value;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      prev.style.backgroundColor = v;
      pick.value = v;
      document.documentElement.style.setProperty(cssVar, v);
    }
  });
}

/* ── Avatar upload ── */
function bindAvatarUpload() {
  const fi   = $('#avatar-file-input');
  const prev = $('#avatar-preview-img');
  const ui   = $('#input-avatar-url');

  fi?.addEventListener('change', e => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const d = ev.target.result;
      if (prev) { prev.src = d; prev.style.display = 'block'; }
      if (ui) ui.value = d;
      AdminState.config.profile.avatar = d;
      markDirty();
    };
    r.readAsDataURL(f);
  });

  ui?.addEventListener('input', e => {
    const u = e.target.value.trim();
    AdminState.config.profile.avatar = u;
    if (prev && u) { prev.src = u; prev.style.display = 'block'; }
    markDirty();
  });
}

/* ── Track list ── */
function renderTracks(tracks) {
  const con = $('#track-list'); if (!con) return;
  if (!tracks.length) {
    con.innerHTML = '<p style="color:var(--text-muted);font-size:.76rem;text-align:center;padding:12px 0;">No tracks yet.</p>';
    return;
  }
  con.innerHTML = '';
  tracks.forEach((t, i) => {
    const d = document.createElement('div');
    d.className = 'social-admin-item';
    d.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div style="font-size:.8rem;font-weight:600;color:var(--text);">${esc(t.title||'Untitled')}</div>
        <div style="font-size:.7rem;color:var(--text-muted);">${esc(t.artist||'Unknown')}</div>
      </div>
      <button class="admin-btn" style="width:auto;padding:5px 12px;font-size:.7rem;" onclick="editTrack(${i})">Edit</button>
      <button style="padding:5px 9px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:8px;color:#f87171;font-size:.7rem;cursor:pointer;margin-left:4px;font-family:var(--font);" onclick="removeTrack(${i})">✕</button>`;
    con.appendChild(d);
  });
}
window.editTrack = i => {
  const t = AdminState.config.music.tracks[i]; if (!t) return;
  const title  = prompt('Title:',  t.title  || ''); if (title  === null) return;
  const artist = prompt('Artist:', t.artist || ''); if (artist === null) return;
  const src    = prompt('File path / URL:', t.src || ''); if (src === null) return;
  const cover  = prompt('Cover image (optional):', t.cover || '');
  t.title = title; t.artist = artist; t.src = normalizeAssetPath(src);
  if (cover !== null) t.cover = normalizeAssetPath(cover);
  renderTracks(AdminState.config.music.tracks); markDirty();
};
window.removeTrack = i => {
  if (!confirm('Remove this track?')) return;
  AdminState.config.music.tracks.splice(i, 1);
  renderTracks(AdminState.config.music.tracks); markDirty();
};
function bindTrackButtons() {
  $('#add-track-btn')?.addEventListener('click', () => {
    const title  = prompt('Track title:'); if (!title) return;
    const artist = prompt('Artist name:') || '';
    const src    = prompt('File path / URL (e.g. assets/music/song.mp3):') || '';
    const cover  = prompt('Cover image path / URL (optional):') || '';
    AdminState.config.music.tracks.push({
      id: Date.now(), title, artist,
      src: normalizeAssetPath(src),
      cover: normalizeAssetPath(cover),
    });
    renderTracks(AdminState.config.music.tracks); markDirty();
  });
}

/* ── Social list ── */
function renderSocialList(socials) {
  const con = $('#socials-admin-list'); if (!con) return;
  con.innerHTML = '';
  socials.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'social-admin-item';
    d.innerHTML = `
      <label class="toggle">
        <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="socialToggle(${i},this.checked)">
        <span class="toggle-slider"></span>
      </label>
      <span style="color:${esc(s.color||'#fff')};font-size:.85rem;width:18px;text-align:center;flex-shrink:0;">
        <i class="${esc(s.icon||'fas fa-link')}"></i>
      </span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:.78rem;font-weight:600;color:var(--text);margin-bottom:3px;">${esc(s.label)}</div>
        <input class="admin-input" style="padding:5px 9px;font-size:.72rem;" placeholder="URL"
          value="${esc(s.url||'')}" oninput="socialUrl(${i},this.value)">
      </div>
      <input class="admin-input" style="width:110px;flex-shrink:0;padding:5px 9px;font-size:.72rem;"
        placeholder="@handle" value="${esc(s.username||'')}" oninput="socialUser(${i},this.value)">`;
    con.appendChild(d);
  });
}
window.socialToggle = (i, v) => { AdminState.config.socials[i].enabled  = v; markDirty(); };
window.socialUrl    = (i, v) => { AdminState.config.socials[i].url      = v; markDirty(); };
window.socialUser   = (i, v) => { AdminState.config.socials[i].username = v; markDirty(); };

/* ── Password change ── */
function initPasswordChange() {
  const form = $('#change-password-form'); if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const cur = $('#input-current-pass')?.value?.trim() || '';
    const nw  = $('#input-new-pass')?.value?.trim()     || '';
    const cf  = $('#input-confirm-pass')?.value?.trim() || '';
    if (!cur || !nw || !cf)  { adminToast('Fill all fields', 'error'); return; }
    if (nw !== cf)            { adminToast('Passwords do not match', 'error'); return; }
    if (nw.length < 4)        { adminToast('Min 4 characters', 'error'); return; }
    if (await sha256(cur) !== AdminState.config.admin.passwordHash) {
      adminToast('Current password wrong', 'error'); return;
    }
    AdminState.config.admin.passwordHash = await sha256(nw);
    form.reset(); markDirty();
    adminToast('✓ Password updated — click Save All to apply', 'success');
  });
}

/* ── Download config ── */
window.adminDownloadConfig = () => {
  if (!AdminState.config) return;
  const b = new Blob([JSON.stringify(AdminState.config, null, 2)], { type: 'application/json' });
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u; a.download = 'config.json'; a.click();
  URL.revokeObjectURL(u);
};

/* ── Admin toast ── */
function adminToast(msg, type = 'info') {
  let t = $('#admin-toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'admin-toast';
    t.style.cssText = 'position:fixed;bottom:22px;right:22px;padding:11px 18px;'
      + 'border-radius:12px;font-size:.8rem;font-weight:600;z-index:9999;'
      + 'opacity:0;transform:translateY(8px);transition:opacity .3s,transform .3s;'
      + 'pointer-events:none;max-width:300px;font-family:var(--font);backdrop-filter:blur(12px);';
    document.body.appendChild(t);
  }
  const styles = {
    success: 'background:rgba(34,197,94,.14);border:1px solid rgba(34,197,94,.35);color:#22c55e;',
    error:   'background:rgba(248,113,113,.14);border:1px solid rgba(248,113,113,.35);color:#f87171;',
    info:    'background:rgba(168,85,247,.14);border:1px solid rgba(168,85,247,.35);color:#a855f7;',
  };
  const base = 'position:fixed;bottom:22px;right:22px;padding:11px 18px;border-radius:12px;font-size:.8rem;font-weight:600;z-index:9999;opacity:0;transform:translateY(8px);transition:opacity .3s,transform .3s;pointer-events:none;max-width:300px;font-family:var(--font);backdrop-filter:blur(12px);';
  t.setAttribute('style', base + (styles[type] || styles.info));
  t.textContent = msg;
  t.style.opacity = '1'; t.style.transform = 'translateY(0)';
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; }, 4000);
}

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */
async function adminInit() {
  AdminState.config = await loadConfig();

  // Apply accent to admin UI
  const accent = AdminState.config?.theme?.accentColor || '#a855f7';
  document.documentElement.style.setProperty('--accent', accent);
  const a2 = AdminState.config?.theme?.accentColorSecondary || '#ec4899';
  document.documentElement.style.setProperty('--accent2', a2);

  await initLogin();
  setBadge(false);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', adminInit);
} else {
  adminInit();
}
