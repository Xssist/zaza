/* ============================================================
   ZAZA — admin.js  (rebuilt, auth bug fixed)
   SHA-256 hashing · inline config fallback · full CRUD
   ============================================================ */
'use strict';

const $  = (s,c=document) => c.querySelector(s);
const $$ = (s,c=document) => [...c.querySelectorAll(s)];

/* ── State ── */
window.AdminState = { config: null, dirty: false };

/* ── SHA-256 (Web Crypto API) ── */
async function sha256(msg) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* ── Session ── */
function saveSession(h) {
  const exp = Date.now() + (AdminState.config?.admin?.sessionTimeout||3600)*1000;
  sessionStorage.setItem('zaza_admin_token', h);
  sessionStorage.setItem('zaza_admin_expiry', String(exp));
}
function checkSession() {
  const tok = sessionStorage.getItem('zaza_admin_token');
  const exp = parseInt(sessionStorage.getItem('zaza_admin_expiry')||'0');
  if (!tok || Date.now()>exp) { clearSession(); return false; }
  return true;
}
function clearSession() {
  sessionStorage.removeItem('zaza_admin_token');
  sessionStorage.removeItem('zaza_admin_expiry');
}

/* ── Config Loader — 4-layer fallback (never fails) ── */
async function loadConfig() {
  // 1. HTTP fetch (works on GitHub Pages / live server)
  try {
    const r = await fetch('./config.json?v='+Date.now());
    if (r.ok) return await r.json();
  } catch(_) {}

  // 2. localStorage override (written by previous admin save)
  const ls = localStorage.getItem('zaza_config_override');
  if (ls) { try { return JSON.parse(ls); } catch(_) {} }

  // 3. Inline config injected in admin.html <script>
  if (window.__ZAZA_CONFIG__) return JSON.parse(JSON.stringify(window.__ZAZA_CONFIG__));

  // 4. Bare minimum fallback so the page still works
  return {
    profile:{ username:'zaza', displayName:'zaza', bio:'', avatar:'', status:'online', statusMessages:[], location:'', joinDate:'2024' },
    theme:{ accentColor:'#a855f7', accentColorSecondary:'#ec4899', particleCount:80, snowEnabled:false, rainEnabled:false },
    background:{ videoUrl:'', overlayOpacity:0.6 },
    music:{ enabled:true, autoPlay:false, defaultVolume:0.5, tracks:[] },
    socials:[], stats:{ showVisitorCount:true, visitorCount:1, showMemberSince:true },
    discord:{ enabled:false, userId:'' }, spotify:{ enabled:false, fallbackText:'' },
    cursor:{ enabled:true, color:'#a855f7' },
    seo:{ title:'zaza — personal', titleCycle:['zaza — personal'], description:'', ogImage:'' },
    admin:{ passwordHash:'6af9676d48eff5f4fea6dd39ffd582ea1d7b5ac0da858923afb16310ecc0d04c', sessionTimeout:3600 },
  };
}

/* ── GitHub API save ── */
async function saveToGitHub(cfg) {
  const tok   = localStorage.getItem('zaza_gh_token');
  const owner = localStorage.getItem('zaza_gh_owner');
  const repo  = localStorage.getItem('zaza_gh_repo');
  if (!tok||!owner||!repo) return false;

  const fr = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/config.json`,
    { headers:{ Authorization:`token ${tok}`, Accept:'application/vnd.github.v3+json' } });
  if (!fr.ok) throw new Error('Could not read file from GitHub');
  const fd = await fr.json();

  const content = btoa(unescape(encodeURIComponent(JSON.stringify(cfg,null,2))));
  const ur = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/config.json`, {
    method:'PUT',
    headers:{ Authorization:`token ${tok}`, Accept:'application/vnd.github.v3+json', 'Content-Type':'application/json' },
    body: JSON.stringify({ message:'chore: update config via admin panel', content, sha:fd.sha }),
  });
  if (!ur.ok) { const e=await ur.json(); throw new Error(e.message||'GitHub update failed'); }
  return true;
}

async function saveConfig(cfg) {
  try { if (await saveToGitHub(cfg)) return { ok:true, method:'github' }; }
  catch(e) { console.warn('GitHub save failed:', e); }
  localStorage.setItem('zaza_config_override', JSON.stringify(cfg,null,2));
  return { ok:true, method:'localStorage' };
}

/* ══════════════════════════════════════════
   LOGIN
══════════════════════════════════════════ */
async function initLogin() {
  if (checkSession()) { showDashboard(); return; }

  const form  = $('#login-form');
  const pinEl = $('#login-password');
  const errEl = $('#login-error');
  const card  = $('#admin-login');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const pass = pinEl?.value?.trim();
    if (!pass) return;

    const btn = form.querySelector('.admin-btn');
    if (btn) { btn.textContent='Verifying…'; btn.disabled=true; }
    errEl?.classList.remove('show');

    try {
      const hash = await sha256(pass);
      const stored = AdminState.config?.admin?.passwordHash || '';

      /* Debug: uncomment to diagnose mismatches
      console.log('entered hash:', hash);
      console.log('stored hash:', stored);
      console.log('match:', hash===stored);
      */

      if (hash === stored) {
        saveSession(hash);
        card?.classList.add('fade-out');
        setTimeout(showDashboard, 400);
      } else {
        if (errEl) { errEl.textContent='Incorrect password.'; errEl.classList.add('show'); }
        pinEl.value=''; pinEl.focus();
        card?.classList.add('shake');
        setTimeout(()=>card?.classList.remove('shake'), 500);
      }
    } catch(err) {
      console.error('Auth error:', err);
      if (errEl) { errEl.textContent='Authentication error — check console.'; errEl.classList.add('show'); }
    } finally {
      if (btn) { btn.textContent='Enter Panel'; btn.disabled=false; }
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
  populateDashboard(AdminState.config);

  $$('.admin-nav-item').forEach(i => i.addEventListener('click', () => activateSection(i.dataset.section)));
  $('#save-all-btn')?.addEventListener('click', doSaveAll);
  $('#logout-btn')?.addEventListener('click', () => { clearSession(); location.reload(); });
  initGHSettings();
  initPasswordChange();
  activateSection('profile');
}

function activateSection(name) {
  $$('.admin-nav-item').forEach(i => i.classList.toggle('active', i.dataset.section===name));
  $$('.admin-section').forEach(s => s.classList.toggle('active', s.id===`section-${name}`));
}

/* ── Save All ── */
async function doSaveAll() {
  const btn=$('#save-all-btn');
  if (btn) { btn.textContent='Saving…'; btn.disabled=true; }
  try {
    collectAll();
    const res = await saveConfig(AdminState.config);
    if (res.ok) {
      adminToast(res.method==='github' ? '✓ Saved to GitHub' : '✓ Saved — download config.json to deploy', 'success');
      if (res.method==='localStorage') downloadConfig();
      AdminState.dirty=false; badge(false);
    }
  } catch(e) { adminToast('✗ '+e.message,'error'); }
  finally { if (btn) { btn.textContent='Save All'; btn.disabled=false; } }
}

function downloadConfig() {
  const b=new Blob([JSON.stringify(AdminState.config,null,2)],{type:'application/json'});
  const u=URL.createObjectURL(b); const a=document.createElement('a');
  a.href=u; a.download='config.json'; a.click(); URL.revokeObjectURL(u);
}
window.adminDownloadConfig = downloadConfig;

function badge(dirty) {
  const el=$('#save-status'); if(!el) return;
  el.className='admin-status-badge '+(dirty?'badge-unsaved':'badge-saved');
  el.textContent=dirty?'Unsaved changes':'Saved';
}
function markDirty() { AdminState.dirty=true; badge(true); }

/* ══════════════════════════════════════════
   POPULATE
══════════════════════════════════════════ */
function populateDashboard(cfg) {
  const set=(s,v)=>{ const e=$(s); if(e) e.value=v; };
  const chk=(s,v)=>{ const e=$(s); if(e) e.checked=!!v; };

  // Profile
  set('#input-username',    cfg.profile?.username||'');
  set('#input-displayname', cfg.profile?.displayName||'');
  set('#input-bio',         cfg.profile?.bio||'');
  set('#input-location',    cfg.profile?.location||'');
  set('#input-join-date',   cfg.profile?.joinDate||'');
  set('#input-status-msgs', (cfg.profile?.statusMessages||[]).join('\n'));
  set('#input-avatar-url',  cfg.profile?.avatar||'');
  const ap=$('#avatar-preview-img');
  if (ap&&cfg.profile?.avatar) { ap.src=cfg.profile.avatar; ap.style.display='block'; }

  // Theme
  set('#input-accent',  cfg.theme?.accentColor||'#a855f7');
  set('#input-accent2', cfg.theme?.accentColorSecondary||'#ec4899');
  cprev('#color-preview-accent',  cfg.theme?.accentColor||'#a855f7');
  cprev('#color-preview-accent2', cfg.theme?.accentColorSecondary||'#ec4899');
  set('#input-particle-count', cfg.theme?.particleCount||80);
  chk('#toggle-snow', cfg.theme?.snowEnabled);
  chk('#toggle-rain', cfg.theme?.rainEnabled);

  // Background
  set('#input-video-url', cfg.background?.videoUrl||'');
  set('#input-overlay-opacity', cfg.background?.overlayOpacity??0.6);
  const od=$('#overlay-display'); if(od) od.textContent=Math.round((cfg.background?.overlayOpacity??0.6)*100);

  // Music
  chk('#toggle-music', cfg.music?.enabled??true);
  set('#input-default-volume', cfg.music?.defaultVolume??0.5);
  const vd=$('#vol-display'); if(vd) vd.textContent=Math.round((cfg.music?.defaultVolume??0.5)*100);
  renderTracks(cfg.music?.tracks||[]);

  // Socials
  renderSocialList(cfg.socials||[]);

  // Discord / Spotify
  chk('#toggle-discord', cfg.discord?.enabled);
  set('#input-discord-id', cfg.discord?.userId||'');
  chk('#toggle-spotify', cfg.spotify?.enabled);
  set('#input-spotify-text', cfg.spotify?.fallbackText||'');

  // Stats
  chk('#toggle-visitor-count', cfg.stats?.showVisitorCount??true);
  set('#input-visitor-count', cfg.stats?.visitorCount||1);
  chk('#toggle-member-since', cfg.stats?.showMemberSince??true);

  // SEO
  set('#input-seo-title',       cfg.seo?.title||'');
  set('#input-seo-title-cycle', (cfg.seo?.titleCycle||[]).join('\n'));
  set('#input-seo-description', cfg.seo?.description||'');
  set('#input-og-image',        cfg.seo?.ogImage||'');

  // Security
  set('#input-session-timeout', cfg.admin?.sessionTimeout||3600);

  bindListeners();
  bindColorPickers();
  bindAvatarUpload();
  bindTrackButtons();
}

function cprev(sel, col) { const e=$(sel); if(e) e.style.backgroundColor=col; }

/* ── Collect all form → config ── */
function collectAll() {
  const cfg = AdminState.config;
  const g=(s)=>$(s)?.value?.trim()||'';
  const gc=(s)=>$(s)?.checked||false;

  cfg.profile.username        = g('#input-username');
  cfg.profile.displayName     = g('#input-displayname');
  cfg.profile.bio             = g('#input-bio');
  cfg.profile.location        = g('#input-location');
  cfg.profile.joinDate        = g('#input-join-date');
  cfg.profile.statusMessages  = g('#input-status-msgs').split('\n').map(s=>s.trim()).filter(Boolean);

  cfg.theme.accentColor           = g('#input-accent');
  cfg.theme.accentColorSecondary  = g('#input-accent2');
  cfg.theme.particleCount         = parseInt(g('#input-particle-count'))||80;
  cfg.theme.snowEnabled           = gc('#toggle-snow');
  cfg.theme.rainEnabled           = gc('#toggle-rain');

  cfg.background.videoUrl       = g('#input-video-url');
  cfg.background.overlayOpacity = parseFloat(g('#input-overlay-opacity'))||0.6;

  cfg.music.enabled       = gc('#toggle-music');
  cfg.music.defaultVolume = parseFloat(g('#input-default-volume'))||0.5;

  cfg.discord.enabled = gc('#toggle-discord');
  cfg.discord.userId  = g('#input-discord-id');
  cfg.spotify.enabled      = gc('#toggle-spotify');
  cfg.spotify.fallbackText = g('#input-spotify-text');

  cfg.stats.showVisitorCount = gc('#toggle-visitor-count');
  cfg.stats.visitorCount     = parseInt(g('#input-visitor-count'))||1;
  cfg.stats.showMemberSince  = gc('#toggle-member-since');

  cfg.seo.title       = g('#input-seo-title');
  cfg.seo.titleCycle  = g('#input-seo-title-cycle').split('\n').map(s=>s.trim()).filter(Boolean);
  cfg.seo.description = g('#input-seo-description');
  cfg.seo.ogImage     = g('#input-og-image');

  cfg.admin.sessionTimeout = parseInt(g('#input-session-timeout'))||3600;
}

function bindListeners() {
  $$('input[id^="input-"],textarea[id^="input-"],input[id^="toggle-"]').forEach(el=>{
    el.addEventListener('input', markDirty);
    el.addEventListener('change', markDirty);
  });
}

/* ── Color Pickers ── */
function bindColorPickers() {
  bindPicker('#input-accent',  '#color-preview-accent',  '#picker-accent',  '--accent');
  bindPicker('#input-accent2', '#color-preview-accent2', '#picker-accent2', '--accent2');
}
function bindPicker(inputSel, prevSel, pickerSel, cssVar) {
  const inp=$(inputSel), prev=$(prevSel), pick=$(pickerSel);
  if (!inp||!prev||!pick) return;
  prev.addEventListener('click',()=>pick.click());
  pick.addEventListener('input',e=>{ const v=e.target.value; inp.value=v; prev.style.backgroundColor=v; document.documentElement.style.setProperty(cssVar,v); markDirty(); });
  inp.addEventListener('input',e=>{ const v=e.target.value; if(/^#[0-9a-fA-F]{6}$/.test(v)){ prev.style.backgroundColor=v; pick.value=v; document.documentElement.style.setProperty(cssVar,v); } });
}

/* ── Avatar ── */
function bindAvatarUpload() {
  const fi=$('#avatar-file-input'), prev=$('#avatar-preview-img'), ui=$('#input-avatar-url');
  fi?.addEventListener('change',e=>{
    const f=e.target.files?.[0]; if(!f) return;
    const r=new FileReader(); r.onload=ev=>{ const d=ev.target.result; if(prev){prev.src=d;prev.style.display='block';} if(ui) ui.value=d; AdminState.config.profile.avatar=d; markDirty(); }; r.readAsDataURL(f);
  });
  ui?.addEventListener('input',e=>{ const u=e.target.value.trim(); AdminState.config.profile.avatar=u; if(prev&&u){prev.src=u;prev.style.display='block';} markDirty(); });
}

/* ── Tracks ── */
function renderTracks(tracks) {
  const con=$('#track-list'); if(!con) return;
  con.innerHTML='';
  if(!tracks.length){ con.innerHTML='<p style="color:var(--text-muted);font-size:.78rem;text-align:center;padding:14px;">No tracks yet.</p>'; return; }
  tracks.forEach((t,i)=>{
    const d=document.createElement('div'); d.className='social-admin-item'; d.dataset.idx=i;
    d.innerHTML=`<div style="flex:1;min-width:0;"><div style="font-size:.8rem;font-weight:600;color:var(--text);">${esc(t.title||'Untitled')}</div><div style="font-size:.7rem;color:var(--text-muted);">${esc(t.artist||'Unknown')}</div></div><button class="admin-btn" style="width:auto;padding:5px 11px;font-size:.7rem;" onclick="editTrack(${i})">Edit</button><button onclick="removeTrack(${i})" style="padding:5px 9px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:8px;color:#f87171;font-size:.7rem;cursor:pointer;margin-left:4px;font-family:var(--font);">✕</button>`;
    con.appendChild(d);
  });
}
window.editTrack=(i)=>{
  const t=AdminState.config.music.tracks[i]; if(!t) return;
  const title=prompt('Title:',t.title||''); const artist=prompt('Artist:',t.artist||'');
  const src=prompt('File URL/path:',t.src||''); const cover=prompt('Cover URL (opt):',t.cover||'');
  if(title!==null) t.title=title; if(artist!==null) t.artist=artist;
  if(src!==null) t.src=src; if(cover!==null) t.cover=cover;
  renderTracks(AdminState.config.music.tracks); markDirty();
};
window.removeTrack=(i)=>{ if(!confirm('Remove?')) return; AdminState.config.music.tracks.splice(i,1); renderTracks(AdminState.config.music.tracks); markDirty(); };
function bindTrackButtons() {
  $('#add-track-btn')?.addEventListener('click',()=>{
    const title=prompt('Title:'); if(!title) return;
    AdminState.config.music.tracks.push({id:Date.now(),title,artist:prompt('Artist:')||'',src:prompt('File URL/path:')||'',cover:prompt('Cover URL (opt):')||''});
    renderTracks(AdminState.config.music.tracks); markDirty();
  });
}

/* ── Social list ── */
function renderSocialList(socials) {
  const con=$('#socials-admin-list'); if(!con) return;
  con.innerHTML='';
  socials.forEach((s,i)=>{
    const d=document.createElement('div'); d.className='social-admin-item';
    d.innerHTML=`<label class="toggle"><input type="checkbox" ${s.enabled?'checked':''} onchange="toggleSocial(${i},this.checked)"><span class="toggle-slider"></span></label><span style="color:${s.color||'#fff'};font-size:.85rem;width:18px;text-align:center;flex-shrink:0;"><i class="${s.icon||'fas fa-link'}"></i></span><div style="flex:1;min-width:0;"><div style="font-size:.78rem;font-weight:600;color:var(--text);margin-bottom:4px;">${esc(s.label)}</div><input class="admin-input" style="padding:5px 9px;font-size:.72rem;" placeholder="URL" value="${esc(s.url||'')}" oninput="updSocialUrl(${i},this.value)"></div><input class="admin-input" style="width:110px;flex-shrink:0;padding:5px 9px;font-size:.72rem;" placeholder="@handle" value="${esc(s.username||'')}" oninput="updSocialUser(${i},this.value)">`;
    con.appendChild(d);
  });
}
window.toggleSocial=(i,v)=>{ AdminState.config.socials[i].enabled=v; markDirty(); };
window.updSocialUrl=(i,v)=>{ AdminState.config.socials[i].url=v; markDirty(); };
window.updSocialUser=(i,v)=>{ AdminState.config.socials[i].username=v; markDirty(); };

/* ── GitHub Settings ── */
function initGHSettings() {
  const ti=$('#input-gh-token'), oi=$('#input-gh-owner'), ri=$('#input-gh-repo');
  if (ti) ti.value=localStorage.getItem('zaza_gh_token')||'';
  if (oi) oi.value=localStorage.getItem('zaza_gh_owner')||'';
  if (ri) ri.value=localStorage.getItem('zaza_gh_repo')||'';

  $('#save-gh-settings')?.addEventListener('click',()=>{
    localStorage.setItem('zaza_gh_token', ti?.value?.trim()||'');
    localStorage.setItem('zaza_gh_owner', oi?.value?.trim()||'');
    localStorage.setItem('zaza_gh_repo',  ri?.value?.trim()||'');
    adminToast('✓ GitHub settings saved','success');
  });

  $('#test-gh-btn')?.addEventListener('click',async()=>{
    const btn=$('#test-gh-btn'); if(btn){btn.textContent='Testing…';btn.disabled=true;}
    try {
      const o=localStorage.getItem('zaza_gh_owner'), r=localStorage.getItem('zaza_gh_repo'), t=localStorage.getItem('zaza_gh_token');
      if(!o||!r||!t) throw new Error('Fill in all fields first');
      const res=await fetch(`https://api.github.com/repos/${o}/${r}`,{headers:{Authorization:`token ${t}`,Accept:'application/vnd.github.v3+json'}});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const data=await res.json();
      adminToast(`✓ Connected to ${data.full_name}`,'success');
    } catch(e){ adminToast('✗ '+e.message,'error'); }
    finally { if(btn){btn.textContent='Test Connection';btn.disabled=false;} }
  });
}

/* ── Password Change ── */
function initPasswordChange() {
  const form=$('#change-password-form'); if(!form) return;
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const cur=$('#input-current-pass')?.value?.trim();
    const nw =$('#input-new-pass')?.value?.trim();
    const cf =$('#input-confirm-pass')?.value?.trim();
    if(!cur||!nw||!cf){ adminToast('Fill all fields','error'); return; }
    if(nw!==cf){ adminToast('Passwords do not match','error'); return; }
    if(nw.length<4){ adminToast('Password too short (min 4)','error'); return; }
    const ch=await sha256(cur);
    if(ch!==AdminState.config.admin.passwordHash){ adminToast('Current password wrong','error'); return; }
    AdminState.config.admin.passwordHash=await sha256(nw);
    form.reset(); markDirty();
    adminToast('✓ Password changed — save to apply','success');
  });
}

/* ── Toast ── */
function adminToast(msg, type='info') {
  let t=$('#admin-toast');
  if(!t){ t=document.createElement('div'); t.id='admin-toast'; t.style.cssText='position:fixed;bottom:22px;right:22px;padding:11px 18px;border-radius:12px;font-size:.8rem;font-weight:600;z-index:9999;opacity:0;transform:translateY(8px);transition:all .3s;pointer-events:none;max-width:280px;font-family:var(--font);backdrop-filter:blur(12px);'; document.body.appendChild(t); }
  const s={success:'background:rgba(34,197,94,.14);border:1px solid rgba(34,197,94,.35);color:#22c55e;',error:'background:rgba(248,113,113,.14);border:1px solid rgba(248,113,113,.35);color:#f87171;',info:'background:rgba(168,85,247,.14);border:1px solid rgba(168,85,247,.35);color:#a855f7;'};
  t.style.cssText+=s[type]||s.info; t.textContent=msg; t.style.opacity='1'; t.style.transform='translateY(0)';
  clearTimeout(t._t); t._t=setTimeout(()=>{t.style.opacity='0';t.style.transform='translateY(8px)';},3500);
}

/* ── Helpers ── */
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }

/* ── Init ── */
async function adminInit() {
  AdminState.config = await loadConfig();
  const accent = AdminState.config?.theme?.accentColor||'#a855f7';
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-glow', `rgba(${parseInt(accent.slice(1,3),16)},${parseInt(accent.slice(3,5),16)},${parseInt(accent.slice(5,7),16)},0.35)`);

  await initLogin();
  badge(false);
}

document.readyState==='loading'
  ? document.addEventListener('DOMContentLoaded', adminInit)
  : adminInit();
