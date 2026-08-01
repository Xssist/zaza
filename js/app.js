/* ============================================================
   ZAZA — app.js  (clean rewrite)
   ============================================================ */
'use strict';

/* ── Helpers ── */
const $   = (s, ctx = document) => ctx.querySelector(s);
const $$  = (s, ctx = document) => [...ctx.querySelectorAll(s)];
const rand = (a, b) => Math.random() * (b - a) + a;
const lerp = (a, b, t) => a + (b - a) * t;

/** Turn local Windows/file paths into web-relative paths for GitHub Pages */
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

/* ── Global state ── */
const S = {
  cfg: null,
  entered: false,
  musicPlaying: false,
  trackIdx: 0,
  audioCtx: null,
  analyser: null,
  sourceNode: null,
  gainNode: null,
  audioEl: null,
  curX: 0, curY: 0,
  folX: 0, folY: 0,
  playPause: null,
};

/* ══════════════════════════════════════════
   1. CONFIG LOADER
   Priority: fetch → localStorage → inline → defaults
══════════════════════════════════════════ */
async function loadConfig() {
  // 1. HTTP fetch (works on GitHub Pages)
  try {
    const r = await fetch('./config.json?t=' + Date.now());
    if (r.ok) { S.cfg = await r.json(); return; }
  } catch (_) {}

  // 2. localStorage (written by admin panel after save)
  try {
    const ls = localStorage.getItem('zaza_config');
    if (ls) { S.cfg = JSON.parse(ls); return; }
  } catch (_) {}

  // 3. Inline fallback (always present in index.html)
  if (window.__ZAZA_CONFIG__) {
    S.cfg = window.__ZAZA_CONFIG__;
    return;
  }

  // 4. Hard defaults
  S.cfg = {
    profile: { username:'zaza', displayName:'zaza', bio:'living in the moment.', avatar:'', status:'online', statusMessages:['just vibing 🎵'], joinDate:'2024' },
    theme:   { accentColor:'#a855f7', accentColorSecondary:'#ec4899', particleCount:80 },
    background: { videoUrl:'', overlayOpacity:0.55 },
    music:   { enabled:true, defaultVolume:0.5, tracks:[] },
    socials: [],
    stats:   { showVisitorCount:true, visitorCount:1 },
    cursor:  { enabled:true },
    seo:     { title:'zaza', titleCycle:[] },
    admin:   { passwordHash:'6af9676d48eff5f4fea6dd39ffd582ea1d7b5ac0da858923afb16310ecc0d04c', sessionTimeout:3600 },
  };
}

/* ══════════════════════════════════════════
   2. THEME  — apply CSS variables
══════════════════════════════════════════ */
function applyTheme() {
  const t = S.cfg.theme;
  const root = document.documentElement;
  root.style.setProperty('--accent',  t.accentColor || '#a855f7');
  root.style.setProperty('--accent2', t.accentColorSecondary || '#ec4899');
  root.style.setProperty('--accent-glow', hexAlpha(t.accentColor || '#a855f7', 0.35));
  const mt = $('meta[name="theme-color"]');
  if (mt) mt.content = t.accentColor || '#a855f7';

  // Font family
  const fontMap = { 'Space Grotesk':'font-space', 'JetBrains Mono':'font-mono' };
  document.body.classList.remove('font-space','font-mono');
  const fc = fontMap[t.fontFamily];
  if (fc) document.body.classList.add(fc);

  // Glassmorphism
  if (t.glassmorphism) document.body.classList.add('glass-mode');
  else document.body.classList.remove('glass-mode');

  // Gradient angle
  const angle = t.gradientAngle ?? 115;
  const ov = $('#bg-overlay');
  if (ov) {
    ov.style.background = `linear-gradient(${angle}deg,rgba(0,0,0,0.88) 0%,rgba(0,0,0,0.60) 40%,rgba(0,0,0,0.30) 65%,rgba(0,0,0,0.55) 100%)`;
  }
}

function hexAlpha(hex, a) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
  const r = parseInt(hex.slice(0,2),16);
  const g = parseInt(hex.slice(2,4),16);
  const b = parseInt(hex.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ══════════════════════════════════════════
   3. LOADING SCREEN
══════════════════════════════════════════ */
function initLoading() {
  const scr  = $('#loading-screen');
  const body = document.getElementById('terminal-body');
  if (!scr) return;

  const lines = [
    { prompt:'$', text:' initializing zaza.wtf', delay:0, cls:'' },
    { prompt:'>', text:' loading assets...', delay:320, cls:'' },
    { prompt:'>', text:' fetching config.json', delay:640, cls:'' },
    { prompt:'✓', text:' config loaded', delay:960, cls:'ok' },
    { prompt:'>', text:' mounting particles engine', delay:1180, cls:'' },
    { prompt:'✓', text:' renderer ready', delay:1420, cls:'ok' },
    { prompt:'>', text:' starting music player', delay:1600, cls:'' },
    { prompt:'✓', text:' all systems online', delay:1800, cls:'ok' },
    { prompt:'$', text:' boot complete — welcome back, master', delay:2050, cls:'ok' },
  ];

  lines.forEach(l => {
    setTimeout(() => {
      if (!body) return;
      const row = document.createElement('div');
      row.className = 'term-line';
      row.innerHTML = `<span class="prompt">${l.prompt}</span><span class="term-text ${l.cls}">${l.text}</span>`;
      body.appendChild(row);
      body.scrollTop = body.scrollHeight;
    }, l.delay);
  });

  // Add blinking cursor
  setTimeout(() => {
    if (body) body.insertAdjacentHTML('beforeend', '<span class="term-cursor-blink"></span>');
  }, 50);

  setTimeout(() => scr.classList.add('hidden'), 2600);
}

/* ══════════════════════════════════════════
   4. BACKGROUND VIDEO
══════════════════════════════════════════ */
function initBackground() {
  const vid = $('#bg-video');
  const ov  = $('#bg-overlay');

  if (ov) ov.style.opacity = S.cfg.background?.overlayOpacity ?? 0.55;

  const videoUrl = normalizeAssetPath(S.cfg.background?.videoUrl);
  if (vid && videoUrl) {
    vid.src = videoUrl;
    vid.muted = true;
    vid.style.display = 'block';
    const blur = S.cfg.background?.blur || 0;
    if (blur > 0) vid.style.filter = `blur(${blur}px)`;
    vid.load();
    const tryPlay = () => vid.play().catch(() => {});
    tryPlay();
    document.addEventListener('click', tryPlay, { once: true });
  }
}

/* ══════════════════════════════════════════
   5. CUSTOM CURSOR
══════════════════════════════════════════ */
function initCursor() {
  if (!S.cfg.cursor?.enabled) return;

  const cur = $('#cursor');
  const fol = $('#cursor-follower');
  const lgt = $('#mouse-light');
  if (!cur) return;

  // Direct position for cursor dot
  document.addEventListener('mousemove', e => {
    S.curX = e.clientX;
    S.curY = e.clientY;
    cur.style.left = e.clientX + 'px';
    cur.style.top  = e.clientY + 'px';
    if (lgt) { lgt.style.left = e.clientX + 'px'; lgt.style.top = e.clientY + 'px'; }
  });

  // Lerp follower
  (function follow() {
    S.folX = lerp(S.folX, S.curX, 0.12);
    S.folY = lerp(S.folY, S.curY, 0.12);
    if (fol) { fol.style.left = S.folX + 'px'; fol.style.top = S.folY + 'px'; }
    requestAnimationFrame(follow);
  })();

  // Hover state via body classes (avoids per-element cursor issues)
  // Apply cursor style from config
  const style = S.cfg.cursor?.style || 'dot';
  document.body.classList.remove('cursor-crosshair','cursor-ring','cursor-emoji');
  if (style !== 'dot') document.body.classList.add('cursor-' + style);

  const hoverSel = 'a, button, [role="button"], .social-row, .badge, .music-btn-mini, .theme-fab, .enter-btn';
  document.addEventListener('mouseover', e => {
    if (e.target.closest(hoverSel)) document.body.classList.add('cursor-hover');
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest(hoverSel)) document.body.classList.remove('cursor-hover');
  });
  document.addEventListener('mousedown', () => document.body.classList.add('cursor-click'));
  document.addEventListener('mouseup',   () => document.body.classList.remove('cursor-click'));
}

/* ══════════════════════════════════════════
   6. PARTICLES
══════════════════════════════════════════ */
function initParticles() {
  const cv = $('#particles-canvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const count = S.cfg.theme?.particleCount || 80;

  const ac = S.cfg.theme?.accentColor || '#a855f7';
  const a2 = S.cfg.theme?.accentColorSecondary || '#ec4899';

  const toRGB = h => {
    h = h.replace('#','');
    if (h.length===3) h=h.split('').map(c=>c+c).join('');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  };
  const [r1,g1,b1] = toRGB(ac);
  const [r2,g2,b2] = toRGB(a2);

  let W = 0, H = 0;
  const resize = () => { W = cv.width = innerWidth; H = cv.height = innerHeight; };
  resize();
  window.addEventListener('resize', resize);

  class Dot {
    init(full) {
      this.x  = rand(0, W);
      this.y  = full ? rand(0, H) : H + 5;
      this.vx = rand(-0.3, 0.3);
      this.vy = rand(-0.5, -0.1);
      this.sz = rand(0.4, 2.2);
      this.op = rand(0.08, 0.45);
      this.life = 1;
      this.decay = rand(0.0005, 0.0018);
      const useA2 = Math.random() > 0.65;
      [this.r, this.g, this.b] = useA2 ? [r2,g2,b2] : [r1,g1,b1];
    }
    constructor() { this.init(true); }
    tick() {
      this.x += this.vx; this.y += this.vy; this.life -= this.decay;
      if (this.life <= 0 || this.y < -5) this.init(false);
    }
    draw() {
      ctx.save();
      ctx.globalAlpha = this.op * this.life;
      ctx.fillStyle = `rgb(${this.r},${this.g},${this.b})`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.sz, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  const dots = Array.from({ length: count }, () => new Dot());

  (function loop() {
    ctx.clearRect(0, 0, W, H);
    // Draw faint connection lines
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const dx = dots[i].x - dots[j].x, dy = dots[i].y - dots[j].y;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < 90) {
          ctx.strokeStyle = `rgba(${r1},${g1},${b1},${(1-d/90)*0.06})`;
          ctx.lineWidth = 0.4;
          ctx.beginPath();
          ctx.moveTo(dots[i].x, dots[i].y);
          ctx.lineTo(dots[j].x, dots[j].y);
          ctx.stroke();
        }
      }
    }
    dots.forEach(d => { d.tick(); d.draw(); });
    requestAnimationFrame(loop);
  })();
}

/* ══════════════════════════════════════════
   7. PROFILE RENDER
══════════════════════════════════════════ */
function renderProfile() {
  const p = S.cfg.profile;

  // Display name
  const unEl = $('#profile-username');
  if (unEl) unEl.textContent = p.displayName || p.username || 'zaza';

  // Bio
  const bioEl = $('#profile-bio');
  if (bioEl) bioEl.textContent = p.bio || '';

  // Avatar
  const wrap = $('#avatar-wrap');
  const avatarUrl = normalizeAssetPath(p.avatar);
  if (wrap && avatarUrl) {
    const img = document.createElement('img');
    img.src = avatarUrl;
    img.alt = p.displayName || 'avatar';
    img.className = 'avatar-img';
    img.onerror = () => img.replaceWith(makeInitial(p));
    const old = wrap.querySelector('.avatar-initial, img.avatar-img');
    if (old) {
      old.replaceWith(img);
    } else {
      // Insert after the ring div, before the online dot
      const ring = wrap.querySelector('.avatar-ring');
      if (ring) ring.insertAdjacentElement('afterend', img);
      else wrap.appendChild(img);
    }
  }

  // Availability dot
  const avail = p.availability || p.status || 'online';
  const dotEl = $('#online-dot');
  if (dotEl) {
    dotEl.className = 'online-dot avail-' + avail;
    if (avail === 'offline') dotEl.style.animation = 'none';
    else dotEl.style.animation = '';
  }

  // Badges
  renderBadges();

  // Socials
  renderSocials();

  // Typewriter
  typewriter($('#status-typewriter'), p.statusMessages || ['just vibing 🎵']);

  // Page title cycle
  titleCycle(S.cfg.seo?.titleCycle || [S.cfg.seo?.title || 'zaza']);
}

function makeInitial(p) {
  const d = document.createElement('div');
  d.className = 'avatar-initial';
  d.textContent = (p.displayName || p.username || 'Z').charAt(0).toUpperCase();
  return d;
}

function renderBadges() {
  const row = $('#badges-row');
  if (!row) return;
  const badges = S.cfg.badges?.length ? S.cfg.badges : [
    { icon:'fab fa-js-square', color:'#F7DF1E', label:'JavaScript' },
    { icon:'fab fa-python',    color:'#3776AB', label:'Python'     },
    { icon:'fab fa-discord',   color:'#5865F2', label:'Discord'    },
    { icon:'fab fa-github',    color:'#ffffff', label:'GitHub'     },
    { icon:'fab fa-html5',     color:'#E34F26', label:'HTML5'      },
    { icon:'fab fa-css3-alt',  color:'#1572B6', label:'CSS3'       },
  ];
  row.innerHTML = '';
  badges.forEach(b => {
    const el = document.createElement('span');
    el.className = 'badge';
    el.title = b.label || '';
    el.innerHTML = `<i class="${b.icon}" style="color:${b.color}"></i>`;
    row.appendChild(el);
  });
}

/* ══════════════════════════════════════════
   SPOTIFY NOW PLAYING
   Uses the Spotify Web API /me/player/currently-playing
   Token is stored in config.spotify.accessToken
   Poll every 15s after entering the site
══════════════════════════════════════════ */
function initSpotify() {
  const sp = S.cfg.spotify;
  if (!sp?.enabled) return;

  const widget    = $('#spotify-widget');
  const idleEl    = $('#spotify-idle');
  const trackEl   = $('#spotify-track');
  const artistEl  = $('#spotify-artist');
  const barsEl    = $('#spotify-bars');
  const idleText  = $('#spotify-idle-text');

  if (!widget) return;

  // Show idle by default if enabled
  if (idleEl) { idleEl.style.display = 'flex'; }
  if (idleText) idleText.textContent = sp.fallbackText || 'not playing';

  async function poll() {
    const token = sp.accessToken;
    if (!token) return;
    try {
      const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: { Authorization: 'Bearer ' + token }
      });

      if (r.status === 204 || r.status === 404) {
        // Nothing playing
        if (widget) widget.style.display = 'none';
        if (idleEl) idleEl.style.display = 'flex';
        return;
      }

      if (!r.ok) {
        // Token expired or error — hide both
        if (widget) widget.style.display = 'none';
        if (idleEl) idleEl.style.display = 'none';
        return;
      }

      const data = await r.json();
      if (!data || !data.item) {
        if (widget) widget.style.display = 'none';
        if (idleEl) idleEl.style.display = 'flex';
        return;
      }

      const track   = data.item.name || 'Unknown';
      const artists = (data.item.artists || []).map(a => a.name).join(', ') || '—';
      const playing = data.is_playing;
      const albumArt = data.item.album?.images?.[0]?.url;

      if (trackEl)  trackEl.textContent  = track;
      if (artistEl) artistEl.textContent = artists;

      // Album art in the icon area
      const iconEl = widget?.querySelector('.spotify-icon');
      if (iconEl && albumArt) {
        iconEl.innerHTML = `<img src="${albumArt}" class="spotify-cover" alt=""/>`;
      } else if (iconEl) {
        iconEl.innerHTML = '<i class="fab fa-spotify"></i>';
      }

      // Animate bars based on playing state
      if (barsEl) {
        barsEl.classList.toggle('paused', !playing);
      }

      if (widget) widget.style.display = 'flex';
      if (idleEl) idleEl.style.display = 'none';

    } catch (e) {
      // Network error — silent fail
    }
  }

  // Poll immediately then every 15s
  poll();
  setInterval(poll, 15000);
}

function renderSocials() {
  const con = $('#socials-container');
  if (!con) return;
  con.innerHTML = '';
  (S.cfg.socials || [])
    .filter(s => s.enabled !== false)
    .forEach(s => {
      const div = document.createElement('div');
      div.className = 'social-row';
      div.style.setProperty('--icon-color', s.color || 'var(--accent)');
      div.innerHTML = `
        <div class="sr-left">
          <i class="${s.icon || 'fas fa-link'} sr-icon"></i>
          <span class="sr-label">${s.label || ''}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="sr-value">${s.username || ''}</span>
          <span class="sr-copy-hint">copy</span>
        </div>`;
      div.addEventListener('click', () => {
        const text = s.username || s.url || '';
        if (!text) return;
        navigator.clipboard?.writeText(text).catch(() => {});
        // Show copy toast
        const ct = document.getElementById('copy-toast');
        if (ct) {
          ct.textContent = `copied ${s.label}!`;
          ct.classList.add('show');
          clearTimeout(ct._t);
          ct._t = setTimeout(() => ct.classList.remove('show'), 1800);
        }
      });
      con.appendChild(div);
    });
}

/* ══════════════════════════════════════════
   8. TYPEWRITER
══════════════════════════════════════════ */
function typewriter(el, msgs) {
  if (!el || !msgs.length) return;
  let mi = 0, ci = 0, deleting = false, paused = false;

  function tick() {
    if (paused) return;
    const msg = msgs[mi];
    if (!deleting) {
      ci++;
      el.textContent = msg.slice(0, ci);
      if (ci === msg.length) {
        paused = true;
        setTimeout(() => { deleting = true; paused = false; step(); }, 2200);
        return;
      }
    } else {
      ci--;
      el.textContent = msg.slice(0, ci);
      if (ci === 0) {
        deleting = false;
        mi = (mi + 1) % msgs.length;
      }
    }
    step();
  }
  function step() { setTimeout(tick, deleting ? 38 : rand(55, 95)); }
  step();
}

/* ══════════════════════════════════════════
   9. PAGE TITLE CYCLE
══════════════════════════════════════════ */
function titleCycle(titles) {
  if (!titles || !titles.length) return;
  let ti = 0, ci = 0, deleting = false, paused = false;

  // Set title immediately so users never see the static HTML <title>
  document.title = titles[0];

  function tick() {
    if (paused) return;
    const t = titles[ti];
    if (!deleting) {
      ci++;
      document.title = t.slice(0, ci);
      if (ci === t.length) {
        paused = true;
        setTimeout(() => { deleting = true; paused = false; step(); }, 2800);
        return;
      }
    } else {
      ci--;
      document.title = t.slice(0, ci) || '|';
      if (ci === 0) { deleting = false; ti = (ti + 1) % titles.length; }
    }
    step();
  }
  function step() { setTimeout(tick, deleting ? 34 : rand(60, 100)); }
  setTimeout(step, 800);
}

/* ══════════════════════════════════════════
   10. MUSIC PLAYER
══════════════════════════════════════════ */
function initMusic() {
  const cfg = S.cfg.music;
  const bar = $('#music-bar');

  if (!cfg?.enabled || !cfg.tracks?.length) {
    if (bar) bar.style.display = 'none';
    return;
  }
  if (bar) bar.style.display = 'flex';

  S.audioEl = new Audio();
  S.audioEl.volume = cfg.defaultVolume ?? 0.5;
  S.audioEl.crossOrigin = 'anonymous';

  /* Web Audio Context — created lazily on first play */
  function ensureCtx() {
    if (S.audioCtx) {
      if (S.audioCtx.state === 'suspended') S.audioCtx.resume();
      return;
    }
    try {
      S.audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
      S.analyser  = S.audioCtx.createAnalyser();
      S.analyser.fftSize = 256;
      S.gainNode  = S.audioCtx.createGain();
      S.gainNode.gain.value = S.audioEl.volume;
      S.sourceNode = S.audioCtx.createMediaElementSource(S.audioEl);
      S.sourceNode.connect(S.analyser);
      S.analyser.connect(S.gainNode);
      S.gainNode.connect(S.audioCtx.destination);
      startVisualizer();
    } catch (e) {
      console.warn('Web Audio setup failed:', e);
    }
  }

  function loadTrack(idx) {
    const track = cfg.tracks[idx];
    if (!track) return;
    S.trackIdx = idx;

    const titleEl  = $('#music-title-mini');
    const artistEl = $('#music-artist-mini');
    const coverEl  = $('#music-cover-mini');
    if (titleEl)  titleEl.textContent  = track.title  || 'Unknown';
    if (artistEl) artistEl.textContent = track.artist || '—';
    if (coverEl) {
      if (track.cover) {
        coverEl.style.backgroundImage = `url(${track.cover})`;
        coverEl.innerHTML = '';
      } else {
        coverEl.style.backgroundImage = '';
        coverEl.innerHTML = '<i class="fas fa-music"></i>';
      }
    }
    S.audioEl.src = normalizeAssetPath(track.src);
    S.audioEl.load();
    const fill = $('#music-progress-fill-mini');
    const time = $('#music-time-mini');
    if (fill) fill.style.width = '0%';
    if (time) time.textContent = '0:00';
  }

  function playPause() {
    ensureCtx();
    if (S.audioEl.paused) {
      S.audioEl.play()
        .then(() => {
          S.musicPlaying = true;
          updatePlayBtn(true);
          $('#music-cover-mini')?.classList.add('playing');
        })
        .catch(e => console.warn('Playback error:', e));
    } else {
      S.audioEl.pause();
      S.musicPlaying = false;
      updatePlayBtn(false);
      $('#music-cover-mini')?.classList.remove('playing');
    }
  }

  function updatePlayBtn(playing) {
    const btn = $('#play-pause-btn');
    if (!btn) return;
    btn.innerHTML = playing
      ? '<i class="fas fa-pause"></i>'
      : '<i class="fas fa-play"></i>';
    // Keep the play-btn class for CSS gradient styling
    btn.className = 'music-btn-mini play-btn';
  }

  S.audioEl.addEventListener('timeupdate', () => {
    if (!S.audioEl.duration) return;
    const pct = (S.audioEl.currentTime / S.audioEl.duration) * 100;
    const fill = $('#music-progress-fill-mini');
    const time = $('#music-time-mini');
    if (fill) fill.style.width = pct + '%';
    if (time) time.textContent = fmtTime(S.audioEl.currentTime);
  });

  S.audioEl.addEventListener('ended', () => {
    if (cfg.tracks.length > 1) {
      loadTrack((S.trackIdx + 1) % cfg.tracks.length);
      S.audioEl.play().catch(() => {});
    } else {
      S.musicPlaying = false;
      updatePlayBtn(false);
      $('#music-cover-mini')?.classList.remove('playing');
    }
  });

  // Volume — update fill track via CSS custom property
  function syncSliderFill(el) {
    const min = parseFloat(el.min) || 0;
    const max = parseFloat(el.max) || 1;
    const pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
    el.style.setProperty('--pct', pct + '%');
  }

  const volSlider = $('#volume-slider');
  if (volSlider) {
    volSlider.value = S.audioEl.volume;
    syncSliderFill(volSlider);
    volSlider.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      S.audioEl.volume = v;
      if (S.gainNode) S.gainNode.gain.value = v;
      syncSliderFill(e.target);
    });
  }

  // Seek
  const prog = $('#music-progress-mini');
  if (prog) {
    prog.addEventListener('click', e => {
      if (!S.audioEl.duration) return;
      S.audioEl.currentTime = (e.offsetX / prog.offsetWidth) * S.audioEl.duration;
    });
  }

  // Buttons
  $('#play-pause-btn')?.addEventListener('click', playPause);
  $('#prev-btn')?.addEventListener('click', () => {
    loadTrack((S.trackIdx - 1 + cfg.tracks.length) % cfg.tracks.length);
    if (S.musicPlaying) S.audioEl.play().catch(() => {});
  });
  $('#next-btn')?.addEventListener('click', () => {
    loadTrack((S.trackIdx + 1) % cfg.tracks.length);
    if (S.musicPlaying) S.audioEl.play().catch(() => {});
  });

  loadTrack(0);
  S.playPause = playPause;
}

function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/* ── Visualizer ── */
function startVisualizer() {
  const cv = $('#visualizer-canvas');
  if (!cv || !S.analyser) return;
  const ctx = cv.getContext('2d');
  const buf = new Uint8Array(S.analyser.frequencyBinCount);

  (function draw() {
    requestAnimationFrame(draw);
    S.analyser.getByteFrequencyData(buf);
    const W = cv.width  = cv.offsetWidth  || 80;
    const H = cv.height = cv.offsetHeight || 24;
    ctx.clearRect(0, 0, W, H);
    const bars = 24;
    const bw = (W / bars) - 1;
    const accent  = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()  || '#a855f7';
    const accent2 = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#ec4899';
    let x = 0;
    for (let i = 0; i < bars; i++) {
      const v  = buf[Math.floor(i / bars * buf.length)];
      const bh = Math.max(2, (v / 255) * H);
      const g  = ctx.createLinearGradient(0, H, 0, H - bh);
      g.addColorStop(0, accent); g.addColorStop(1, accent2);
      ctx.fillStyle = g;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, H - bh, bw, bh, 1);
      else ctx.rect(x, H - bh, bw, bh);
      ctx.fill();
      x += bw + 1;
    }
  })();
}

/* ══════════════════════════════════════════
   11. ENTER SCREEN
══════════════════════════════════════════ */
function initEnter() {
  const es  = $('#enter-screen');
  const mp  = $('#main-page');
  const btn = $('#enter-btn');
  if (!es || !btn) return;

  function doEnter() {
    if (S.entered) return;
    S.entered = true;

    // Start music
    if (S.cfg.music?.enabled && S.playPause) {
      try { S.playPause(); } catch (_) {}
    }

    es.classList.add('hidden');

    setTimeout(() => {
      if (mp) mp.classList.add('visible');
      // Show theme FAB
      const fab = $('#theme-fab');
      if (fab) fab.classList.add('visible');
    }, 250);
  }

  btn.addEventListener('click', doEnter);
  // Keyboard: Enter or Space
  document.addEventListener('keydown', e => {
    if (!S.entered && (e.code === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      doEnter();
    }
  });
}

/* ══════════════════════════════════════════
   12. KEYBOARD SHORTCUTS (post-enter)
══════════════════════════════════════════ */
function initKeys() {
  document.addEventListener('keydown', e => {
    if (!S.entered || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'Space') {
      e.preventDefault();
      S.playPause?.();
      // Read state after a microtask so playPause has updated S.musicPlaying
      setTimeout(() => toast(S.musicPlaying ? '▶ Playing' : '⏸ Paused'), 50);
    }
    if (e.code === 'ArrowRight' && e.altKey) { $('#next-btn')?.click(); toast('⏭ Next'); }
    if (e.code === 'ArrowLeft'  && e.altKey) { $('#prev-btn')?.click(); toast('⏮ Prev'); }
    if (e.code === 'KeyM') {
      const v = $('#volume-slider');
      if (v) {
        v.value = parseFloat(v.value) > 0 ? '0' : '0.5';
        v.dispatchEvent(new Event('input'));
        toast(parseFloat(v.value) > 0 ? '🔊 Unmuted' : '🔇 Muted');
      }
    }
  });
}

/* ══════════════════════════════════════════
   13. THEME FAB — cycle accent presets
══════════════════════════════════════════ */
function initThemeFab() {
  const fab = $('#theme-fab');
  if (!fab) return;
  const presets = [
    { a:'#a855f7', b:'#ec4899' },
    { a:'#3b82f6', b:'#06b6d4' },
    { a:'#10b981', b:'#34d399' },
    { a:'#f59e0b', b:'#ef4444' },
    { a:'#f97316', b:'#ec4899' },
  ];
  let idx = 0;
  fab.addEventListener('click', () => {
    idx = (idx + 1) % presets.length;
    const { a, b } = presets[idx];
    const root = document.documentElement;
    root.style.setProperty('--accent',  a);
    root.style.setProperty('--accent2', b);
    root.style.setProperty('--accent-glow', hexAlpha(a, 0.35));
    toast('🎨 Theme changed');
  });
}

/* ══════════════════════════════════════════
   14. WEATHER (snow / rain)
══════════════════════════════════════════ */
function initWeather() {
  const t = S.cfg.theme;
  if (!t?.snowEnabled && !t?.rainEnabled) return;
  const type = t.snowEnabled ? 'snow' : 'rain';

  if (!document.getElementById('weather-kf')) {
    const s = document.createElement('style');
    s.id = 'weather-kf';
    s.textContent = '@keyframes wFall{from{transform:translateY(-20px);opacity:1}to{transform:translateY(110vh);opacity:.1}}';
    document.head.appendChild(s);
  }

  for (let i = 0; i < 55; i++) {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;pointer-events:none;z-index:5;animation:wFall linear infinite;`
      + `left:${rand(0,100)}%;top:${rand(-20,0)}%;animation-duration:${rand(6,14)}s;animation-delay:${rand(0,8)}s;opacity:${rand(0.2,0.7)};`;
    if (type === 'snow') {
      el.textContent = '❄';
      el.style.fontSize = rand(5, 12) + 'px';
      el.style.color = 'rgba(255,255,255,.7)';
    } else {
      el.style.width = '1px';
      el.style.height = rand(10, 24) + 'px';
      el.style.background = 'linear-gradient(to bottom,transparent,rgba(180,220,255,.4))';
    }
    document.body.appendChild(el);
  }
}

/* ══════════════════════════════════════════
   15. TOAST
══════════════════════════════════════════ */
function toast(msg, dur = 1800) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), dur);
}

/* ══════════════════════════════════════════
   ANNOUNCEMENT BANNER
══════════════════════════════════════════ */
function initAnnouncement() {
  const ann = S.cfg.announcement;
  if (!ann?.enabled || !ann?.text) return;

  const banner  = $('#ann-banner');
  const textEl  = $('#ann-text');
  const emojiEl = $('#ann-emoji');
  const closeEl = $('#ann-close');
  if (!banner) return;

  // Check if dismissed this session
  const dismissed = sessionStorage.getItem('ann_dismissed');
  if (dismissed === ann.text) return;

  if (textEl)  textEl.textContent  = ann.text;
  if (emojiEl) emojiEl.textContent = ann.emoji || '📢';

  // Apply custom color to banner border
  if (ann.color) {
    banner.style.borderBottomColor = ann.color + '44';
    banner.style.boxShadow = `0 1px 0 ${ann.color}22, 0 8px 32px rgba(0,0,0,.3)`;
  }

  banner.classList.remove('hidden');
  document.body.classList.add('has-banner');

  closeEl?.addEventListener('click', () => {
    banner.classList.add('hidden');
    document.body.classList.remove('has-banner');
    sessionStorage.setItem('ann_dismissed', ann.text);
  });
}

/* ══════════════════════════════════════════
   BACKGROUND PATTERNS
   Modes: aurora, matrix, starfield, mesh
   Set via S.cfg.background.pattern
══════════════════════════════════════════ */
function initBgPattern() {
  const pattern = S.cfg.background?.pattern;
  if (!pattern || pattern === 'none' || pattern === 'video') return;

  // Create canvas
  let cv = document.getElementById('bg-pattern-canvas');
  if (!cv) {
    cv = document.createElement('canvas');
    cv.id = 'bg-pattern-canvas';
    cv.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;';
    document.getElementById('bg-layer')?.appendChild(cv);
  }

  const ctx = cv.getContext('2d');
  let W = 0, H = 0;
  const resize = () => { W = cv.width = innerWidth; H = cv.height = innerHeight; };
  resize();
  window.addEventListener('resize', resize);

  const ac = S.cfg.theme?.accentColor || '#a855f7';
  const a2 = S.cfg.theme?.accentColorSecondary || '#ec4899';

  if (pattern === 'aurora') {
    // Flowing aurora waves
    const waves = Array.from({length: 5}, (_, i) => ({
      offset: i * Math.PI * 0.4,
      speed:  0.0003 + i * 0.0001,
      amp:    60 + i * 25,
      y:      0.3 + i * 0.08,
      color:  i % 2 === 0 ? ac : a2,
      alpha:  0.04 + i * 0.01,
    }));

    let t = 0;
    (function draw() {
      requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);
      t += 1;
      waves.forEach(w => {
        ctx.beginPath();
        ctx.moveTo(0, H * w.y);
        for (let x = 0; x <= W; x += 4) {
          const y = H * w.y + Math.sin((x * 0.005) + t * w.speed * 1000 + w.offset) * w.amp
                            + Math.sin((x * 0.002) + t * w.speed * 500) * (w.amp * 0.5);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
        const grad = ctx.createLinearGradient(0, 0, W, 0);
        grad.addColorStop(0,   w.color + '00');
        grad.addColorStop(0.3, w.color + Math.round(w.alpha * 255).toString(16).padStart(2,'0'));
        grad.addColorStop(0.7, w.color + Math.round(w.alpha * 255).toString(16).padStart(2,'0'));
        grad.addColorStop(1,   w.color + '00');
        ctx.fillStyle = grad;
        ctx.fill();
      });
    })();

  } else if (pattern === 'matrix') {
    // Matrix rain with accent color
    const cols  = Math.floor(W / 14);
    const drops = Array.from({length: cols}, () => Math.floor(rand(0, H / 14)));
    const chars = '01アイウエオカキクケコサシスセソタチツテト';
    let t = 0;

    (function draw() {
      requestAnimationFrame(draw);
      t++;
      ctx.fillStyle = 'rgba(6,6,11,0.05)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = '13px "JetBrains Mono", monospace';
      drops.forEach((y, i) => {
        const ch = chars[Math.floor(Math.random() * chars.length)];
        const brightness = Math.random() > 0.95 ? 'rgba(255,255,255,0.9)' : ac + 'aa';
        ctx.fillStyle = brightness;
        ctx.fillText(ch, i * 14, y * 14);
        if (y * 14 > H && Math.random() > 0.975) drops[i] = 0;
        else drops[i]++;
      });
    })();

  } else if (pattern === 'starfield') {
    // 3D starfield warp
    const stars = Array.from({length: 200}, () => ({
      x: rand(-W/2, W/2), y: rand(-H/2, H/2), z: rand(0, W),
      px: 0, py: 0,
    }));

    (function draw() {
      requestAnimationFrame(draw);
      ctx.fillStyle = 'rgba(6,6,11,0.15)';
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2, cy = H / 2;
      stars.forEach(s => {
        const sx = (s.x / s.z) * W + cx;
        const sy = (s.y / s.z) * H + cy;
        const r  = Math.max(0.1, (1 - s.z / W) * 2.5);
        const op = (1 - s.z / W);

        if (s.px !== 0) {
          ctx.strokeStyle = ac + Math.round(op * 180).toString(16).padStart(2,'0');
          ctx.lineWidth = r * 0.6;
          ctx.beginPath(); ctx.moveTo(s.px, s.py); ctx.lineTo(sx, sy); ctx.stroke();
        }
        ctx.fillStyle = ac + Math.round(op * 220).toString(16).padStart(2,'0');
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();

        s.px = sx; s.py = sy;
        s.z -= 2;
        if (s.z <= 0) { s.x = rand(-W/2, W/2); s.y = rand(-H/2, H/2); s.z = W; s.px = 0; s.py = 0; }
      });
    })();

  } else if (pattern === 'mesh') {
    // Flowing gradient mesh
    const pts = Array.from({length: 8}, (_, i) => ({
      x: rand(0, W), y: rand(0, H),
      vx: rand(-0.4, 0.4), vy: rand(-0.4, 0.4),
      color: i % 2 === 0 ? ac : a2,
      r: rand(200, 400),
    }));

    (function draw() {
      requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);
      pts.forEach(p => {
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        grad.addColorStop(0,   p.color + '18');
        grad.addColorStop(0.5, p.color + '08');
        grad.addColorStop(1,   p.color + '00');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        p.x += p.vx; p.y += p.vy;
        if (p.x < -p.r || p.x > W + p.r) p.vx *= -1;
        if (p.y < -p.r || p.y > H + p.r) p.vy *= -1;
      });
    })();
  }
}

/* ══════════════════════════════════════════
   MAIN INIT
══════════════════════════════════════════ */
async function init() {
  initLoading();
  await loadConfig();
  applyTheme();
  initBackground();
  initBgPattern();
  initCursor();
  initParticles();
  initWeather();
  initAnnouncement();
  initEnter();
  initMusic();
  renderProfile();
  initSpotify();
  initKeys();
  initThemeFab();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
