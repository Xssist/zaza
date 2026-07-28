/* ============================================================
   ZAZA — Premium Bio-Link | admin.js
   Admin panel: auth, config read/write, live preview,
   social management, file uploads, color pickers
   ============================================================ */

'use strict';

/* ── Utility ── */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/* ── State ── */
const AdminState = {
  config: null,
  dirty: false,
  session: null,
};

/* ── SHA-256 for password hashing (no external deps) ── */
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ── Session Management ── */
function saveSession(token) {
  const expiry = Date.now() + (AdminState.config?.admin?.sessionTimeout || 3600) * 1000;
  sessionStorage.setItem('zaza_admin_token', token);
  sessionStorage.setItem('zaza_admin_expiry', expiry.toString());
}

function checkSession() {
  const token = sessionStorage.getItem('zaza_admin_token');
  const expiry = parseInt(sessionStorage.getItem('zaza_admin_expiry') || '0');
  if (!token || Date.now() > expiry) {
    clearSession();
    return false;
  }
  return true;
}

function clearSession() {
  sessionStorage.removeItem('zaza_admin_token');
  sessionStorage.removeItem('zaza_admin_expiry');
}

/* ── Config Loader ── */
async function loadConfig() {
  // Try fetch first (works when served via HTTP/GitHub Pages)
  try {
    const res = await fetch('./config.json?v=' + Date.now());
    if (res.ok) return res.json();
  } catch (e) {
    // fetch blocked on file:// protocol — fall through to inline fallback
  }

  // Fallback: read from window.__ZAZA_CONFIG__ injected by admin.html,
  // or from localStorage override written by a previous save
  const lsOverride = localStorage.getItem('zaza_config_override');
  if (lsOverride) {
    try { return JSON.parse(lsOverride); } catch (e) { /* malformed, ignore */ }
  }

  if (window.__ZAZA_CONFIG__) return window.__ZAZA_CONFIG__;

  throw new Error('Could not load config.json');
}

/* ── Config Saver (writes via fetch to a local save endpoint,
      falls back to download if no server) ── */
async function saveConfig(cfg) {
  // Try to PATCH/PUT via a simple server endpoint
  // Since this is pure static HTML, we use the GitHub API approach
  // or fall back to localStorage + download
  try {
    const saved = await saveToGitHub(cfg);
    if (saved) return { ok: true, method: 'github' };
  } catch (e) {
    console.warn('GitHub save failed, falling back to localStorage:', e);
  }

  // Fallback: store in localStorage and offer download
  localStorage.setItem('zaza_config_override', JSON.stringify(cfg, null, 2));
  return { ok: true, method: 'localStorage' };
}

/* ── GitHub API Save ── */
async function saveToGitHub(cfg) {
  const ghToken = localStorage.getItem('zaza_gh_token');
  const ghRepo  = localStorage.getItem('zaza_gh_repo');
  const ghOwner = localStorage.getItem('zaza_gh_owner');

  if (!ghToken || !ghRepo || !ghOwner) return false;

  // Get current file SHA
  const fileRes = await fetch(
    `https://api.github.com/repos/${ghOwner}/${ghRepo}/contents/config.json`,
    { headers: { Authorization: `token ${ghToken}`, Accept: 'application/vnd.github.v3+json' } }
  );

  if (!fileRes.ok) throw new Error('Could not fetch file SHA from GitHub');
  const fileData = await fileRes.json();
  const sha = fileData.sha;

  // Encode content
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(cfg, null, 2))));

  // Commit update
  const updateRes = await fetch(
    `https://api.github.com/repos/${ghOwner}/${ghRepo}/contents/config.json`,
    {
      method: 'PUT',
      headers: {
        Authorization: `token ${ghToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'chore: update config via admin panel',
        content,
        sha,
      }),
    }
  );

  if (!updateRes.ok) {
    const err = await updateRes.json();
    throw new Error(err.message || 'GitHub update failed');
  }
  return true;
}

/* ── Login Flow ── */
async function initLogin() {
  const form     = $('#login-form');
  const passInput = $('#login-password');
  const errEl    = $('#login-error');
  const loginCard = $('#admin-login');

  if (!form) return;

  // Auto-login if valid session exists
  if (checkSession()) {
    showDashboard();
    return;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const pass = passInput?.value?.trim();
    if (!pass) return;

    const btn = form.querySelector('.admin-btn');
    if (btn) { btn.textContent = 'Verifying...'; btn.disabled = true; }

    try {
      const hash = await sha256(pass);
      const storedHash = AdminState.config?.admin?.passwordHash || '';

      if (hash === storedHash) {
        saveSession(hash);
        errEl?.classList.remove('show');
        loginCard?.classList.add('fade-out');
        setTimeout(showDashboard, 400);
      } else {
        if (errEl) { errEl.textContent = 'Incorrect password.'; errEl.classList.add('show'); }
        passInput.value = '';
        passInput.focus();
        // Shake animation
        loginCard?.classList.add('shake');
        setTimeout(() => loginCard?.classList.remove('shake'), 500);
      }
    } catch (err) {
      console.error('Auth error:', err);
      if (errEl) { errEl.textContent = 'Authentication error.'; errEl.classList.add('show'); }
    } finally {
      if (btn) { btn.textContent = 'Enter Panel'; btn.disabled = false; }
    }
  });
}

/* ── Show Dashboard ── */
function showDashboard() {
  $('#admin-login')?.classList.add('hidden');
  const dash = $('#admin-dashboard');
  if (dash) {
    dash.classList.add('visible');
    populateDashboard(AdminState.config);
  }

  // Nav
  $$('.admin-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const section = item.dataset.section;
      activateSection(section);
    });
  });

  // Save all
  $('#save-all-btn')?.addEventListener('click', doSaveAll);

  // Logout
  $('#logout-btn')?.addEventListener('click', () => {
    clearSession();
    location.reload();
  });

  // GitHub settings
  initGitHubSettings();

  // Activate first section
  activateSection('profile');
}

function activateSection(name) {
  $$('.admin-nav-item').forEach(i => i.classList.toggle('active', i.dataset.section === name));
  $$('.admin-section').forEach(s => s.classList.toggle('active', s.id === `section-${name}`));
}

/* ── Save All ── */
async function doSaveAll() {
  const btn = $('#save-all-btn');
  if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }

  try {
    collectAllFormValues();
    const result = await saveConfig(AdminState.config);

    if (result.ok) {
      if (result.method === 'github') {
        showAdminToast('✓ Saved to GitHub successfully', 'success');
      } else {
        showAdminToast('✓ Saved locally — download config.json to deploy', 'success');
        offerConfigDownload();
      }
      AdminState.dirty = false;
      updateSaveStatus(false);
    }
  } catch (err) {
    showAdminToast('✗ Save failed: ' + err.message, 'error');
  } finally {
    if (btn) { btn.textContent = 'Save All'; btn.disabled = false; }
  }
}

function offerConfigDownload() {
  const json = JSON.stringify(AdminState.config, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'config.json'; a.click();
  URL.revokeObjectURL(url);
}

function updateSaveStatus(dirty) {
  const badge = $('#save-status');
  if (!badge) return;
  badge.className = 'admin-status-badge ' + (dirty ? 'badge-unsaved' : 'badge-saved');
  badge.textContent = dirty ? 'Unsaved changes' : 'Saved';
}

function markDirty() {
  AdminState.dirty = true;
  updateSaveStatus(true);
}

/* ── Populate Dashboard ── */
function populateDashboard(cfg) {
  // ── Profile Section ──
  setVal('#input-username',     cfg.profile?.username     || '');
  setVal('#input-displayname',  cfg.profile?.displayName  || '');
  setVal('#input-bio',          cfg.profile?.bio          || '');
  setVal('#input-location',     cfg.profile?.location     || '');
  setVal('#input-join-date',    cfg.profile?.joinDate     || '');
  setVal('#input-status-msgs',  (cfg.profile?.statusMessages || []).join('\n'));

  // ── Avatar preview ──
  const avatarPreview = $('#avatar-preview-img');
  if (avatarPreview && cfg.profile?.avatar) {
    avatarPreview.src = cfg.profile.avatar;
    avatarPreview.style.display = 'block';
  }

  // ── Theme Section ──
  setVal('#input-accent',  cfg.theme?.accentColor          || '#a855f7');
  setVal('#input-accent2', cfg.theme?.accentColorSecondary || '#ec4899');
  setColorPreview('#color-preview-accent',  cfg.theme?.accentColor          || '#a855f7');
  setColorPreview('#color-preview-accent2', cfg.theme?.accentColorSecondary || '#ec4899');
  setVal('#input-particle-count', cfg.theme?.particleCount || 80);
  setChecked('#toggle-snow', cfg.theme?.snowEnabled || false);
  setChecked('#toggle-rain', cfg.theme?.rainEnabled || false);

  // ── Background Section ──
  setVal('#input-video-url', cfg.background?.videoUrl || '');
  setVal('#input-overlay-opacity', cfg.background?.overlayOpacity ?? 0.6);

  // ── Music Section ──
  setChecked('#toggle-music', cfg.music?.enabled ?? true);
  setVal('#input-default-volume', cfg.music?.defaultVolume ?? 0.5);
  renderTrackList(cfg.music?.tracks || []);

  // ── Socials Section ──
  renderSocialAdminList(cfg.socials || []);

  // ── Discord Section ──
  setChecked('#toggle-discord', cfg.discord?.enabled || false);
  setVal('#input-discord-id', cfg.discord?.userId || '');

  // ── Spotify Section ──
  setChecked('#toggle-spotify', cfg.spotify?.enabled || false);
  setVal('#input-spotify-text', cfg.spotify?.fallbackText || '');

  // ── Stats Section ──
  setChecked('#toggle-visitor-count', cfg.stats?.showVisitorCount ?? true);
  setVal('#input-visitor-count', cfg.stats?.visitorCount || 1);
  setChecked('#toggle-member-since', cfg.stats?.showMemberSince ?? true);

  // ── SEO Section ──
  setVal('#input-seo-title',       cfg.seo?.title       || '');
  setVal('#input-seo-description', cfg.seo?.description || '');
  setVal('#input-og-image',        cfg.seo?.ogImage     || '');

  // ── Admin Section ──
  setVal('#input-session-timeout', cfg.admin?.sessionTimeout || 3600);

  // Bind all change listeners
  bindChangeListeners();
  bindColorPickers();
  bindAvatarUpload();
  bindTrackActions();
}

/* ── Value Helpers ── */
function setVal(sel, val) {
  const el = $(sel);
  if (el) el.value = val;
}

function setChecked(sel, val) {
  const el = $(sel);
  if (el) el.checked = !!val;
}

function setColorPreview(sel, color) {
  const el = $(sel);
  if (el) el.style.backgroundColor = color;
}

/* ── Collect All Form Values Back to Config ── */
function collectAllFormValues() {
  const cfg = AdminState.config;

  // Profile
  cfg.profile.username     = getVal('#input-username');
  cfg.profile.displayName  = getVal('#input-displayname');
  cfg.profile.bio          = getVal('#input-bio');
  cfg.profile.location     = getVal('#input-location');
  cfg.profile.joinDate     = getVal('#input-join-date');
  cfg.profile.statusMessages = getVal('#input-status-msgs')
    .split('\n').map(s => s.trim()).filter(Boolean);

  // Theme
  cfg.theme.accentColor          = getVal('#input-accent');
  cfg.theme.accentColorSecondary = getVal('#input-accent2');
  cfg.theme.particleCount        = parseInt(getVal('#input-particle-count')) || 80;
  cfg.theme.snowEnabled          = getChecked('#toggle-snow');
  cfg.theme.rainEnabled          = getChecked('#toggle-rain');

  // Background
  cfg.background.videoUrl         = getVal('#input-video-url');
  cfg.background.overlayOpacity   = parseFloat(getVal('#input-overlay-opacity')) || 0.6;

  // Music
  cfg.music.enabled        = getChecked('#toggle-music');
  cfg.music.defaultVolume  = parseFloat(getVal('#input-default-volume')) || 0.5;
  // tracks are managed separately

  // Discord
  cfg.discord.enabled = getChecked('#toggle-discord');
  cfg.discord.userId  = getVal('#input-discord-id');

  // Spotify
  cfg.spotify.enabled      = getChecked('#toggle-spotify');
  cfg.spotify.fallbackText = getVal('#input-spotify-text');

  // Stats
  cfg.stats.showVisitorCount = getChecked('#toggle-visitor-count');
  cfg.stats.visitorCount     = parseInt(getVal('#input-visitor-count')) || 1;
  cfg.stats.showMemberSince  = getChecked('#toggle-member-since');

  // SEO
  cfg.seo.title       = getVal('#input-seo-title');
  cfg.seo.description = getVal('#input-seo-description');
  cfg.seo.ogImage     = getVal('#input-og-image');

  // Admin
  cfg.admin.sessionTimeout = parseInt(getVal('#input-session-timeout')) || 3600;

  // Collect socials from DOM
  collectSocials();
}

function getVal(sel) {
  return $(sel)?.value?.trim() || '';
}

function getChecked(sel) {
  return $(sel)?.checked || false;
}

/* ── Change Listeners ── */
function bindChangeListeners() {
  const inputs = $$('input[id^="input-"], textarea[id^="input-"], input[id^="toggle-"]');
  inputs.forEach(el => {
    el.addEventListener('input', markDirty);
    el.addEventListener('change', markDirty);
  });
}

/* ── Color Pickers ── */
function bindColorPickers() {
  // Accent color
  const accentInput   = $('#input-accent');
  const accentPreview = $('#color-preview-accent');
  const accentPicker  = $('#picker-accent');

  if (accentPreview && accentPicker) {
    accentPreview.addEventListener('click', () => accentPicker.click());
    accentPicker.addEventListener('input', e => {
      const val = e.target.value;
      if (accentInput) accentInput.value = val;
      accentPreview.style.backgroundColor = val;
      // Live preview in page
      document.documentElement.style.setProperty('--accent', val);
      markDirty();
    });
  }

  // Accent2 color
  const accent2Input   = $('#input-accent2');
  const accent2Preview = $('#color-preview-accent2');
  const accent2Picker  = $('#picker-accent2');

  if (accent2Preview && accent2Picker) {
    accent2Preview.addEventListener('click', () => accent2Picker.click());
    accent2Picker.addEventListener('input', e => {
      const val = e.target.value;
      if (accent2Input) accent2Input.value = val;
      accent2Preview.style.backgroundColor = val;
      document.documentElement.style.setProperty('--accent2', val);
      markDirty();
    });
  }

  // Sync text input → preview
  accentInput?.addEventListener('input', e => {
    const val = e.target.value;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      if (accentPreview) accentPreview.style.backgroundColor = val;
      if (accentPicker) accentPicker.value = val;
      document.documentElement.style.setProperty('--accent', val);
    }
  });

  accent2Input?.addEventListener('input', e => {
    const val = e.target.value;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      if (accent2Preview) accent2Preview.style.backgroundColor = val;
      if (accent2Picker) accent2Picker.value = val;
      document.documentElement.style.setProperty('--accent2', val);
    }
  });
}

/* ── Avatar Upload ── */
function bindAvatarUpload() {
  const input   = $('#avatar-file-input');
  const preview = $('#avatar-preview-img');
  const urlInput = $('#input-avatar-url');

  if (input) {
    input.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target.result;
        if (preview) { preview.src = dataUrl; preview.style.display = 'block'; }
        if (urlInput) urlInput.value = dataUrl;
        AdminState.config.profile.avatar = dataUrl;
        markDirty();
      };
      reader.readAsDataURL(file);
    });
  }

  urlInput?.addEventListener('input', e => {
    const url = e.target.value.trim();
    AdminState.config.profile.avatar = url;
    if (preview && url) { preview.src = url; preview.style.display = 'block'; }
    markDirty();
  });
}

/* ── Track List ── */
function renderTrackList(tracks) {
  const container = $('#track-list');
  if (!container) return;
  container.innerHTML = '';

  if (!tracks.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:16px;">No tracks added yet.</p>';
    return;
  }

  tracks.forEach((track, idx) => {
    const item = document.createElement('div');
    item.className = 'social-admin-item';
    item.dataset.idx = idx;
    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
        <div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:0.9rem;color:#fff;">
          <i class="fas fa-music"></i>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.82rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(track.title || 'Untitled')}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);">${escapeHtml(track.artist || 'Unknown Artist')}</div>
        </div>
      </div>
      <button class="admin-btn" style="width:auto;padding:6px 12px;font-size:0.72rem;margin-left:8px;" onclick="editTrack(${idx})">Edit</button>
      <button onclick="removeTrack(${idx})" style="padding:6px 10px;background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.3);border-radius:8px;color:#f87171;font-size:0.75rem;cursor:pointer;margin-left:4px;font-family:var(--font);">✕</button>
    `;
    container.appendChild(item);
  });
}

window.editTrack = function(idx) {
  const track = AdminState.config.music.tracks[idx];
  if (!track) return;
  const title  = prompt('Track title:', track.title  || '');
  const artist = prompt('Artist name:', track.artist || '');
  const src    = prompt('Audio file URL/path:', track.src || '');
  const cover  = prompt('Cover image URL/path (optional):', track.cover || '');
  if (title !== null) track.title  = title;
  if (artist !== null) track.artist = artist;
  if (src !== null) track.src = src;
  if (cover !== null) track.cover = cover;
  renderTrackList(AdminState.config.music.tracks);
  markDirty();
};

window.removeTrack = function(idx) {
  if (!confirm('Remove this track?')) return;
  AdminState.config.music.tracks.splice(idx, 1);
  renderTrackList(AdminState.config.music.tracks);
  markDirty();
};

function bindTrackActions() {
  $('#add-track-btn')?.addEventListener('click', () => {
    const title  = prompt('Track title:');
    if (!title) return;
    const artist = prompt('Artist name:') || '';
    const src    = prompt('Audio file URL/path (assets/music/track.mp3):') || '';
    const cover  = prompt('Cover image URL/path (optional):') || '';
    AdminState.config.music.tracks.push({ id: Date.now(), title, artist, src, cover });
    renderTrackList(AdminState.config.music.tracks);
    markDirty();
  });
}

/* ── Social Admin List ── */
function renderSocialAdminList(socials) {
  const container = $('#socials-admin-list');
  if (!container) return;
  container.innerHTML = '';

  socials.forEach((social, idx) => {
    const item = document.createElement('div');
    item.className = 'social-admin-item';
    item.dataset.idx = idx;
    item.innerHTML = `
      <label class="toggle" title="Enable/Disable">
        <input type="checkbox" ${social.enabled ? 'checked' : ''} onchange="toggleSocial(${idx}, this.checked)">
        <span class="toggle-slider"></span>
      </label>
      <span style="width:28px;height:28px;border-radius:6px;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:0.85rem;color:${social.color || '#fff'};">
        <i class="${social.icon || 'fas fa-link'}"></i>
      </span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.8rem;font-weight:600;color:var(--text);">${escapeHtml(social.label)}</div>
        <input
          class="admin-input"
          style="margin-top:4px;padding:5px 10px;font-size:0.75rem;"
          placeholder="URL"
          value="${escapeHtml(social.url || '')}"
          oninput="updateSocialUrl(${idx}, this.value)"
        >
      </div>
      <input
        class="admin-input"
        style="width:120px;flex-shrink:0;padding:5px 10px;font-size:0.75rem;"
        placeholder="@username"
        value="${escapeHtml(social.username || '')}"
        oninput="updateSocialUsername(${idx}, this.value)"
      >
    `;
    container.appendChild(item);
  });
}

window.toggleSocial = function(idx, enabled) {
  AdminState.config.socials[idx].enabled = enabled;
  markDirty();
};

window.updateSocialUrl = function(idx, url) {
  AdminState.config.socials[idx].url = url;
  markDirty();
};

window.updateSocialUsername = function(idx, username) {
  AdminState.config.socials[idx].username = username;
  markDirty();
};

function collectSocials() {
  // Already live-updated via above functions; nothing extra needed
}

/* ── GitHub Settings ── */
function initGitHubSettings() {
  const tokenInput = $('#input-gh-token');
  const repoInput  = $('#input-gh-repo');
  const ownerInput = $('#input-gh-owner');

  // Load saved values
  if (tokenInput) tokenInput.value = localStorage.getItem('zaza_gh_token') || '';
  if (repoInput)  repoInput.value  = localStorage.getItem('zaza_gh_repo')  || '';
  if (ownerInput) ownerInput.value = localStorage.getItem('zaza_gh_owner') || '';

  $('#save-gh-settings')?.addEventListener('click', () => {
    localStorage.setItem('zaza_gh_token', tokenInput?.value?.trim() || '');
    localStorage.setItem('zaza_gh_repo',  repoInput?.value?.trim()  || '');
    localStorage.setItem('zaza_gh_owner', ownerInput?.value?.trim() || '');
    showAdminToast('✓ GitHub settings saved', 'success');
  });

  // Test connection
  $('#test-gh-btn')?.addEventListener('click', async () => {
    const btn = $('#test-gh-btn');
    if (btn) { btn.textContent = 'Testing...'; btn.disabled = true; }
    try {
      const owner = localStorage.getItem('zaza_gh_owner');
      const repo  = localStorage.getItem('zaza_gh_repo');
      const token = localStorage.getItem('zaza_gh_token');
      if (!owner || !repo || !token) throw new Error('Fill in all fields first');
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      showAdminToast(`✓ Connected to ${data.full_name}`, 'success');
    } catch (err) {
      showAdminToast('✗ ' + err.message, 'error');
    } finally {
      if (btn) { btn.textContent = 'Test Connection'; btn.disabled = false; }
    }
  });
}

/* ── Password Change ── */
function initPasswordChange() {
  const form = $('#change-password-form');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const current = $('#input-current-pass')?.value?.trim();
    const newPass  = $('#input-new-pass')?.value?.trim();
    const confirm  = $('#input-confirm-pass')?.value?.trim();

    if (!current || !newPass || !confirm) {
      showAdminToast('Fill in all fields', 'error'); return;
    }
    if (newPass !== confirm) {
      showAdminToast('New passwords do not match', 'error'); return;
    }
    if (newPass.length < 6) {
      showAdminToast('Password must be at least 6 characters', 'error'); return;
    }

    const currentHash = await sha256(current);
    if (currentHash !== AdminState.config.admin.passwordHash) {
      showAdminToast('Current password is wrong', 'error'); return;
    }

    AdminState.config.admin.passwordHash = await sha256(newPass);
    form.reset();
    markDirty();
    showAdminToast('✓ Password updated — save to apply', 'success');
  });
}

/* ── Toast ── */
function showAdminToast(msg, type = 'info') {
  let toast = $('#admin-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'admin-toast';
    toast.style.cssText = `
      position:fixed;bottom:24px;right:24px;padding:12px 20px;
      border-radius:12px;font-size:0.82rem;font-weight:600;z-index:9999;
      opacity:0;transform:translateY(10px);transition:all 0.3s ease;
      pointer-events:none;max-width:280px;font-family:var(--font);
      backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
    `;
    document.body.appendChild(toast);
  }

  const styles = {
    success: 'background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.4);color:#22c55e;',
    error:   'background:rgba(248,113,113,0.15);border:1px solid rgba(248,113,113,0.4);color:#f87171;',
    info:    'background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.4);color:#a855f7;',
  };

  toast.style.cssText += styles[type] || styles.info;
  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';

  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
  }, 3500);
}

/* ── Helpers ── */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ── Main Init ── */
async function adminInit() {
  try {
    AdminState.config = await loadConfig();
  } catch (e) {
    console.error('Could not load config:', e);
    AdminState.config = {};
  }

  // Apply accent color to admin panel too
  const accent = AdminState.config?.theme?.accentColor || '#a855f7';
  document.documentElement.style.setProperty('--accent', accent);

  await initLogin();
  initPasswordChange();
  updateSaveStatus(false);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', adminInit);
} else {
  adminInit();
}
