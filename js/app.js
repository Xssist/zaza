/* ============================================================
   ZADE — app.js  (clean rewrite)
   ============================================================ */
'use strict';

/* ── Helpers ── */
const $   = (s, ctx = document) => ctx.querySelector(s);
const $$  = (s, ctx = document) => [...ctx.querySelectorAll(s)];
const rand = (a, b) => Math.random() * (b - a) + a;
const lerp = (a, b, t) => a + (b - a) * t;

// Small lifecycle helpers keep background work paused when the page is hidden.
function onPageVisible(callback) {
  const run = () => { if (!document.hidden) callback(); };
  document.addEventListener('visibilitychange', run, { passive: true });
  return () => document.removeEventListener('visibilitychange', run);
}

function createVisibilityInterval(callback, delay) {
  let timer = 0;
  const schedule = () => {
    if (!document.hidden) timer = window.setTimeout(() => { callback(); schedule(); }, delay);
  };
  schedule();
  const stop = () => { clearTimeout(timer); timer = 0; };
  const handleVisibility = () => { if (document.hidden) stop(); else start(); };
  const start = () => { stop(); schedule(); };
  document.addEventListener('visibilitychange', handleVisibility, { passive: true });
  return () => {
    stop();
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}

/** Turn local Windows/file paths into web-relative paths for GitHub Pages.
    Remote https:// image URLs (e.g. Discord CDN attachments) are allowed through. */
function normalizeAssetPath(path) {
  if (!path || typeof path !== 'string') return '';
  path = path.trim();
  if (!path || /^(?:data:|blob:|javascript:|file:)/i.test(path)) return '';
  if (/^https:\/\//i.test(path)) {
    try { const u = new URL(path); return u.protocol === 'https:' ? u.href : ''; }
    catch (_) { return ''; }
  }
  if (/^http:\/\//i.test(path)) return '';
  const m = path.match(/assets[/\\][^?#]+$/i);
  return (m ? m[0] : path.replace(/^\/+/, '')).replace(/\\/g, '/');
}

function safeExternalUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim(), window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch (_) { return ''; }
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
  spotifyInterval: null,
  prefersReduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  // Consolidated mousemove handlers
  _mouseMoveHandlers: [],
  perf: { dpr: 1, quality: 1, hidden: document.hidden },
};

/* Rendering budget shared by visual subsystems. Hidden tabs stop visual loops;
   quality changes only after sustained pressure to avoid oscillation. */
const RenderBudget = {
  slowFrames: 0,
  fastFrames: 0,
  update(ms) {
    if (ms > 24) { this.slowFrames++; this.fastFrames = 0; }
    else if (ms < 17) { this.fastFrames++; this.slowFrames = 0; }
    if (this.slowFrames > 45) { S.perf.quality = Math.max(.55, S.perf.quality - .15); this.slowFrames = 0; }
    if (this.fastFrames > 180) { S.perf.quality = Math.min(1, S.perf.quality + .1); this.fastFrames = 0; }
  }
};
document.addEventListener('visibilitychange', () => { S.perf.hidden = document.hidden; });
/* Never surface benign async failures (media, clipboard, sockets) as console errors */
window.addEventListener('unhandledrejection', e => e.preventDefault());

/* ══════════════════════════════════════════
   1. CONFIG LOADER
   Priority: fetch → localStorage → inline → defaults
   localStorage treated as untrusted — validated before use
══════════════════════════════════════════ */
function _ensureConfig(cfg) {
  const defaults = _defaultConfig();
  const result = { ...defaults, ...(cfg || {}) };
  for (const key of ['profile', 'theme', 'background', 'music', 'cursor', 'seo']) {
    result[key] = { ...defaults[key], ...(cfg?.[key] || {}) };
  }
  result.cursor.trail = { ...defaults.cursor.trail, ...(cfg?.cursor?.trail || {}) };
  result.music.tracks = Array.isArray(cfg?.music?.tracks) ? cfg.music.tracks : [];
  result.socials = Array.isArray(cfg?.socials) ? cfg.socials : [];
  return result;
}

async function loadConfig() {
  // 1. HTTP fetch (works on GitHub Pages) — most trusted source
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const r = await fetch('./config.json', { signal: controller.signal, cache: 'no-cache' });
    clearTimeout(timeout);
    if (r.ok) {
      const cfg = await r.json();
      if (_validateConfig(cfg)) { S.cfg = _ensureConfig(cfg); return; }
    }
  } catch (_) {}

  // 2. localStorage — treat as UNTRUSTED user-controlled data
  try {
    const ls = localStorage.getItem('zade_config');
    if (ls) {
      const parsed = JSON.parse(ls);
      if (_validateConfig(parsed)) {
        S.cfg = _ensureConfig(_sanitizeConfig(parsed));
        return;
      } else {
        // Corrupted or tampered — remove it
        localStorage.removeItem('zade_config');
      }
    }
  } catch (_) {
    localStorage.removeItem('zade_config');
  }

  // 3. Inline fallback
  if (window.__ZADE_CONFIG__) {
    S.cfg = _ensureConfig(_sanitizeConfig(window.__ZADE_CONFIG__));
    return;
  }

  // 4. Hard defaults
  S.cfg = _ensureConfig(_defaultConfig());
}

/* ── Config validator — reject obviously poisoned data ── */
function _validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  // Must have basic expected shape
  if (cfg.profile && typeof cfg.profile !== 'object') return false;
  if (cfg.theme  && typeof cfg.theme  !== 'object') return false;
  if (cfg.socials && !Array.isArray(cfg.socials))   return false;
  // Reject if any string field is suspiciously long (potential injection)
  const MAX = 2000;
  const checkStrings = (obj, depth = 0) => {
    if (depth > 4) return true;
    for (const v of Object.values(obj || {})) {
      if (typeof v === 'string' && v.length > MAX) return false;
      if (typeof v === 'object' && v !== null && !checkStrings(v, depth + 1)) return false;
    }
    return true;
  };
  return checkStrings(cfg);
}

/* ── Config sanitizer — strip script injections from string values ── */
function _sanitizeConfig(cfg) {
  const clean = JSON.parse(JSON.stringify(cfg)); // deep clone
  const sanitizeStr = s => {
    if (typeof s !== 'string') return s;
    // Strip script tags and event handlers
    return s
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/javascript\s*:/gi, '')
      .replace(/on\w+\s*=/gi, '');
  };
  const walk = obj => {
    if (typeof obj !== 'object' || obj === null) return obj;
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'string') obj[k] = sanitizeStr(obj[k]);
      else if (typeof obj[k] === 'object') walk(obj[k]);
    }
    return obj;
  };
  // Never let localStorage config override admin auth settings
  delete clean.admin;
  return walk(clean);
}

function _defaultConfig() {
  return {
    profile: { username:'zade', displayName:'zade', bio:'living in the moment.', avatar:'assets/images/avatar.png', status:'online', availability:'online', statusMessages:['just vibing 🎵'], joinDate:'2024' },
    theme:   { accentColor:'#ffffff', accentColorSecondary:'#ffffff', particleCount:80, glassmorphism:true, gradientAngle:160 },
    background: { videoUrl:'assets/images/background.mp4', overlayOpacity:0.35 },
    music:   { enabled:true, defaultVolume:0.5, tracks:[] },
    socials: [],
    cursor:  { enabled:true, style:'dot', trail:{ style:'dots', length:12, fadeSpeed:300, color:'' } },
    seo:     { title:'zade', titleCycle:['zade — personal portfolio'], description:'' },
  };
}

/* ══════════════════════════════════════════
   2. THEME  — apply CSS variables
══════════════════════════════════════════ */
function applySeo() {
  const seo = S.cfg.seo || {};
  const title = seo.title || '';
  if (title) document.title = title;
  const description = document.querySelector('meta[name="description"]');
  if (description && seo.description) description.content = seo.description;
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle && title) ogTitle.content = title;
  const ogDescription = document.querySelector('meta[property="og:description"]');
  if (ogDescription && seo.description) ogDescription.content = seo.description;
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage && seo.ogImage) ogImage.content = normalizeAssetPath(seo.ogImage) || seo.ogImage;
}

function applyTheme() {
  applySeo();
  const t = S.cfg.theme || {};
  const root = document.documentElement;
  root.style.setProperty('--accent',  t.accentColor || '#ffffff');
  root.style.setProperty('--accent2', t.accentColorSecondary || '#ffffff');
  root.style.setProperty('--accent-glow', hexAlpha(t.accentColor || '#ffffff', 0.35));
  const mt = $('meta[name="theme-color"]');
  if (mt) mt.content = S.cfg.seo?.themeColor || t.accentColor || '#ffffff';

  // Font family
  const fontMap = { 'Space Grotesk':'font-space', 'JetBrains Mono':'font-mono' };
  document.body.classList.remove('font-space','font-mono');
  const fc = fontMap[t.fontFamily];
  if (fc) document.body.classList.add(fc);

  // Glassmorphism
  if (t.glassmorphism) document.body.classList.add('glass-mode');
  else document.body.classList.remove('glass-mode');

  // Gradient angle — overlay is set by initBackground, just store the value
  // so initBackground can pick it up after config loads
  const angle = t.gradientAngle ?? 160;
  document.documentElement.style.setProperty('--gradient-angle', angle + 'deg');
}

function hexAlpha(hex, a) {
  if (typeof hex !== 'string' || !/^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim())) return `rgba(255,255,255,${a})`;
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
  const r = parseInt(hex.slice(0,2),16);
  const g = parseInt(hex.slice(2,4),16);
  const b = parseInt(hex.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ══════════════════════════════════════════
   2.5 DARK MODE — auto-detect + toggle
══════════════════════════════════════════ */
function initDarkMode() {
  // The site is intentionally monochrome black — never invert to light mode,
  // as the editorial typography uses fixed light-on-dark colors.
  document.documentElement.setAttribute('data-theme', 'dark');
  try { localStorage.setItem('zade_theme', 'dark'); } catch (_) {}
}

/* ══════════════════════════════════════════
   2.6 SOUND EFFECTS — subtle audio feedback
══════════════════════════════════════════ */
const SoundSystem = {
  enabled: true,
  sounds: {
    click:   { freq: 800, duration: 100 },
    hover:   { freq: 600, duration: 80 },
    toggle:  { freq: 1000, duration: 150 },
    success: { freq: 1200, duration: 200 },
    error:   { freq: 300, duration: 200 },
  },

  init() {
    // AudioContext created lazily in play() — avoids autoplay-policy warnings at page load
    this.enabled = localStorage.getItem('zade_sounds') !== 'false';
  },

  play(name) {
    if (!this.enabled || !this.sounds[name]) return;
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      const sound = this.sounds[name];
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.frequency.value = sound.freq;
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + sound.duration / 1000);
      osc.start(now);
      osc.stop(now + sound.duration / 1000);
    } catch (e) {
      // Silent fail if audio context unavailable
    }
  },
};

function playSound(name) {
  SoundSystem.play(name);
}

/* ── Track analytics ── */
function trackEvent(event, data) {
  let analytics = {};
  try {
    analytics = JSON.parse(localStorage.getItem('zade_analytics') || '{}') || {};
  } catch (_) {
    analytics = {};
  }
  if (!Array.isArray(analytics.events)) analytics.events = [];
  analytics.events.push({ event, data, timestamp: Date.now() });
  if (analytics.events.length > 1000) analytics.events.shift(); // Limit to 1000 events
  try {
    localStorage.setItem('zade_analytics', JSON.stringify(analytics));
  } catch (_) {}
}

/* ══════════════════════════════════════════
   3. LOADING SCREEN
══════════════════════════════════════════ */
function initLoading() {
  const scr  = $('#loading-screen');
  const body = document.getElementById('terminal-body');
  if (!scr) return;

  const lines = [
    { prompt:'zade@arch', text:' ~ $ uname -a', delay:0,    cls:'' },
    { prompt:'',          text:' Linux zade 6.6.1-arch1 #1 SMP PREEMPT x86_64 GNU/Linux', delay:200, cls:'ok' },
    { prompt:'zade@arch', text:' ~ $ cat /etc/motd', delay:420, cls:'' },
    { prompt:'',          text:' welcome back. loading your space...', delay:620, cls:'ok' },
    { prompt:'zade@arch', text:' ~ $ systemctl start zade.service', delay:900, cls:'' },
    { prompt:'',          text:' [ OK ] Started zade personal portfolio.', delay:1100, cls:'ok' },
    { prompt:'zade@arch', text:' ~ $ zade --init', delay:1320, cls:'' },
    { prompt:'',          text:' [ OK ] particles engine   ready', delay:1480, cls:'ok' },
    { prompt:'',          text:' [ OK ] music player       ready', delay:1600, cls:'ok' },
    { prompt:'',          text:' [ OK ] all systems        online', delay:1720, cls:'ok' },
    { prompt:'zade@arch', text:' ~ $ _', delay:1950, cls:'' },
  ];

  lines.forEach(l => {
    setTimeout(() => {
      if (!body) return;
      const row = document.createElement('div');
      row.className = 'term-line';
      if (l.prompt) {
        const prompt = document.createElement('span');
      prompt.className = 'prompt'; prompt.textContent = l.prompt;
      const text = document.createElement('span');
      text.className = `term-text ${l.cls}`; text.textContent = l.text;
      row.append(prompt, text);
      } else {
        const text = document.createElement('span');
      text.className = `term-text ${l.cls}`; text.style.paddingLeft = '4px'; text.textContent = l.text;
      row.appendChild(text);
      }
      body.appendChild(row);
      body.scrollTop = body.scrollHeight;
    }, l.delay);
  });

  // Add blinking cursor
  setTimeout(() => {
    if (body) body.insertAdjacentHTML('beforeend', '<span class="term-cursor-blink"></span>');
  }, 50);

  setTimeout(() => scr.classList.add('hidden'), 2700);
}

/* ══════════════════════════════════════════
   4. BACKGROUND — premium 4K wallpaper system
   Supports: video + image, GPU-accelerated,
   blur artifact layer, fade-in, parallax
══════════════════════════════════════════ */
function initBackground() {
  const vid      = $('#bg-video');
  const imgWrap  = $('#bg-image-wrap');
  const blurLayer= $('#bg-blur-layer');
  const ov       = $('#bg-overlay');

  // Apply overlay from config
  if (ov) {
    const angle = S.cfg.theme?.gradientAngle ?? 160;
    const op    = Math.max(0, Math.min(1, Number(S.cfg.background?.overlayOpacity) || 0.35));
    ov.style.background = `linear-gradient(${angle}deg,
      rgba(8,8,15,${Math.min(op + 0.30, 0.75)}) 0%,
      rgba(8,8,15,${Math.min(op + 0.05, 0.45)}) 30%,
      rgba(8,8,15,${Math.max(op - 0.15, 0.12)}) 55%,
      rgba(8,8,15,${Math.min(op + 0.08, 0.50)}) 100%)`;
  }

  const videoUrl = normalizeAssetPath(S.cfg.background?.videoUrl);
  const imageUrl = normalizeAssetPath(S.cfg.background?.imageUrl || '');

  /* ── Image background ── */
  if (imageUrl && imgWrap) {
    _loadImageBackground(imageUrl, imgWrap, blurLayer);
  }

  /* ── Video background ── */
  if (vid && videoUrl) {
    const blur = S.cfg.background?.blur || 0;
    if (blur > 0) vid.style.filter = `blur(${blur}px)`;

    // Preload the video metadata first for smoother start
    vid.style.display = 'block';
    vid.muted   = true;
    vid.loop    = true;
    vid.preload = 'auto';
    vid.src     = videoUrl;
    vid.load();

    // Fade in only after enough data is buffered
    const fadeInVideo = () => {
      vid.classList.add('loaded');
      // If there's also a static image, hide it once video is playing
      if (imageUrl && imgWrap) {
        setTimeout(() => {
          imgWrap.style.transition = 'opacity 1s ease';
          imgWrap.style.opacity = '0';
          if (blurLayer) blurLayer.classList.remove('visible');
        }, 1200);
      }
    };

    vid.addEventListener('canplaythrough', fadeInVideo, { once: true });
    vid.addEventListener('loadeddata',     fadeInVideo, { once: true });
    // If the video is missing or unsupported, hide it instead of logging media errors
    vid.addEventListener('error', () => {
      vid.style.display = 'none';
      vid.removeAttribute('src');
      vid.load();
    }, { once: true });

    const tryPlay = () => vid.play().catch(() => {});
    tryPlay();
    document.addEventListener('click', tryPlay, { once: true });
  }

  /* ── Parallax on background ── */
  if (!S.prefersReduced && !window.matchMedia('(hover: none)').matches) {
    const targets = [vid, imgWrap].filter(Boolean);
    S._mouseMoveHandlers.push(e => {
      const mx = (e.clientX / window.innerWidth  - 0.5) * 2;
      const my = (e.clientY / window.innerHeight - 0.5) * 2;
      const tx = (mx * 14).toFixed(2);
      const ty = (my *  9).toFixed(2);
      const transform = `translate3d(${-tx}px, ${-ty}px, 0) scale(1.04)`;
      targets.forEach(el => {
        if (el && el.style.opacity !== '0') el.style.transform = transform;
      });
    });
  }
}

/* ── Premium image loader ── */
function _loadImageBackground(url, wrap, blurLayer) {
  // Preload via Image() so we know exact dimensions before displaying
  const img = new Image();
  img.onload = () => {
    // Set blur artifact layer first (same image, blurred, slightly ahead of real)
    if (blurLayer) {
      blurLayer.style.backgroundImage = `url(${url})`;
      blurLayer.classList.add('visible');
    }

    // Short delay so blur layer is "behind" when main image fades in
    setTimeout(() => {
      wrap.style.backgroundImage    = `url(${url})`;
      wrap.style.backgroundSize     = 'cover';
      wrap.style.backgroundPosition = 'center center';
      wrap.style.backgroundRepeat   = 'no-repeat';
      // Force GPU compositing layer
      wrap.style.willChange         = 'transform, opacity';
      wrap.style.transform          = 'scale(1.04)';
      wrap.classList.add('loaded');

      // Once image is crisp, fade out blur layer
      setTimeout(() => {
        if (blurLayer) {
          blurLayer.style.transition = 'opacity .8s ease';
          blurLayer.style.opacity    = '0';
        }
      }, 600);
    }, 80);
  };

  img.onerror = () => {
    // Fallback — still apply without preload
    wrap.style.backgroundImage = `url(${url})`;
    wrap.classList.add('loaded');
  };

  img.src = url;
}

/* ══════════════════════════════════════════
   5. CUSTOM CURSOR
══════════════════════════════════════════ */
function initCursor() {
  if (!S.cfg.cursor?.enabled) return;
  // Don't run on touch-only devices
  if (window.matchMedia('(hover: none)').matches) return;

  const cur = $('#cursor');
  const fol = $('#cursor-follower');
  const lgt = $('#mouse-light');
  if (!cur) return;

  // Register in consolidated mousemove
  S._mouseMoveHandlers.push(e => {
    S.curX = e.clientX;
    S.curY = e.clientY;
    cur.style.left = e.clientX + 'px';
    cur.style.top  = e.clientY + 'px';
    if (lgt) { lgt.style.left = e.clientX + 'px'; lgt.style.top = e.clientY + 'px'; }
  });

  // Lerp follower
  let followFrame;
  (function follow(now) {
    if (!S.perf.hidden) {
      const step = Math.min(1, (now - (follow.last || now)) / 16.67);
      follow.last = now;
      S.folX = lerp(S.folX, S.curX, 1 - Math.pow(0.88, step));
      S.folY = lerp(S.folY, S.curY, 1 - Math.pow(0.88, step));
      if (fol) fol.style.transform = `translate3d(${S.folX}px,${S.folY}px,0)`;
    }
    followFrame = requestAnimationFrame(follow);
  })(performance.now());
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(followFrame); else followFrame = requestAnimationFrame(follow); });

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
  if (S.prefersReduced) return; // respect reduced motion
  const cv = $('#particles-canvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const count = Math.max(0, Math.min(200, Number(S.cfg.theme?.particleCount) || 80));

  const ac = S.cfg.theme?.accentColor || '#ffffff';
  const a2 = S.cfg.theme?.accentColorSecondary || '#ffffff';

  const toRGB = h => {
    h = h.replace('#','');
    if (h.length===3) h=h.split('').map(c=>c+c).join('');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  };
  const safeHex = h => /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(h || '').trim()) ? String(h).trim() : '#ffffff';
  const [r1,g1,b1] = toRGB(safeHex(ac));
  const [r2,g2,b2] = toRGB(safeHex(a2));

  // Mobile / touch devices get fewer particles, no link lines, lower DPR — biggest battery + FPS win
  const isMobile = window.matchMedia('(max-width: 700px)').matches || window.matchMedia('(hover: none)').matches;
  const drawLinks = !isMobile;
  const finalCount = Math.round((isMobile ? Math.min(count, 30) : count) * S.perf.quality);

  let W = 0, H = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
    S.perf.dpr = dpr;
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });
  cv.style.contain = 'strict';
  cv.style.transform = 'translate3d(0,0,0)';

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
      const step = this._step || 1;
      this.x += this.vx * step; this.y += this.vy * step; this.life -= this.decay * step;
      if (this.life <= 0 || this.y < -5) this.init(false);
    }
    draw() {
      ctx.globalAlpha = this.op * this.life;
      ctx.fillStyle = `rgb(${this.r},${this.g},${this.b})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.sz, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const dots = Array.from({ length: finalCount }, () => new Dot());
  const DIST_SQ = 90 * 90; // avoid Math.sqrt — compare squared distances

  let lastFrame = performance.now();
  (function loop(now) {
    if (S.perf.hidden) { requestAnimationFrame(loop); return; }
    const frameStart = performance.now();
    const delta = Math.min((now - lastFrame) / 16.67, 2); lastFrame = now;
    ctx.clearRect(0, 0, W, H);

    // Batch all connection lines into a single path + stroke call
    // (skipped on mobile — O(n²) per frame is not worth it on phones)
    if (drawLinks) {
    ctx.beginPath();
    ctx.lineWidth = 0.4;
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const dx = dots[i].x - dots[j].x, dy = dots[i].y - dots[j].y;
        const d2 = dx*dx + dy*dy;
        if (d2 < DIST_SQ) {
          const alpha = (1 - Math.sqrt(d2) / 90) * 0.06;
          ctx.globalAlpha = alpha;
          ctx.moveTo(dots[i].x, dots[i].y);
          ctx.lineTo(dots[j].x, dots[j].y);
        }
      }
    }
    ctx.strokeStyle = `rgb(${r1},${g1},${b1})`;
    ctx.stroke();
    }

    // Draw dots (no save/restore per dot — manage globalAlpha directly)
    ctx.shadowColor = '';
    ctx.shadowBlur = 0;
    dots.forEach(d => { d._step = delta; d.tick(); d.draw(); });
    ctx.globalAlpha = 1;

    RenderBudget.update(performance.now() - frameStart);
    requestAnimationFrame(loop);
  })(performance.now());
}

/* ══════════════════════════════════════════
   7. PROFILE RENDER
══════════════════════════════════════════ */
function renderProfile() {
  const p = S.cfg.profile || {};
  const name = p.displayName || p.username || 'zade';
  const location = $('#profile-location');
  const footer = $('#footer-name');
  if (location) location.textContent = p.location || '—';
  if (footer) footer.textContent = name;
  const greeting = $('#hero-greeting');
  const hour = new Date().getHours();
  if (greeting) greeting.textContent = `${hour >= 5 && hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : hour < 23 ? 'Good evening' : "You're up late"}, visitor.`;
  const updateClock = () => { const now = new Date(); const clock = $('#hero-time'); if (clock) clock.textContent = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', hour12:false}); };
  updateClock();
  createVisibilityInterval(updateClock, 30000);
  renderProjects();

  // Display name
  const unEl = $('#profile-username');
  if (unEl) unEl.textContent = p.displayName || p.username || 'zade';

  // Bio and the editable second About paragraph
  const bioEl = $('#profile-bio');
  if (bioEl) bioEl.textContent = p.bio || '';
  const aboutExtraEl = $('#profile-about-extra');
  if (aboutExtraEl) aboutExtraEl.textContent = p.aboutExtra || "When I'm not coding, I'm usually working on something new or learning something I haven't touched before.";
  const focusEl = $('#profile-focus');
  if (focusEl) focusEl.textContent = p.focus || 'Web development';
  const subtitleEl = $('#profile-subtitle');
  if (subtitleEl) subtitleEl.textContent = p.subtitle || 'Developer · Creator';
  const aboutHeadingEl = $('#about-heading');
  if (aboutHeadingEl) aboutHeadingEl.textContent = p.aboutHeading || 'A little about me.';

  // Avatar
  const wrap = $('#avatar-wrap');
  const avatarUrl = normalizeAssetPath(p.avatar);
  if (wrap && avatarUrl) {
    const img = document.createElement('img');
    img.src = avatarUrl;
    img.alt = `${p.displayName || p.username || 'Profile'} avatar`;
    img.className = 'avatar-img';
    img.style.opacity = '0';
    img.style.transition = 'opacity .5s ease';
    img.onload  = () => { img.style.opacity = '1'; };
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

  // Skills
  renderSkills();

  // Socials
  renderSocials();

  // Typewriter
  typewriter($('#status-typewriter'), p.statusMessages || ['just vibing 🎵']);

  // Page title cycle
  titleCycle(S.cfg.seo?.titleCycle || [S.cfg.seo?.title || 'zade']);
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
  const badges = S.cfg.badges?.length ? S.cfg.badges : [];
  row.innerHTML = '';
  badges.forEach(b => {
    const el = document.createElement('span');
    el.className = 'badge';
    el.title = b.label || '';
    const icon = document.createElement('i');
    icon.className = b.icon;
    icon.style.color = b.color;
    el.appendChild(icon);
    row.appendChild(el);
  });
}

function renderSkills() {
  const container = $('#skills-container');
  if (!container) return;
  const groups = Array.isArray(S.cfg.skills) ? S.cfg.skills : [];
  container.innerHTML = '';
  groups.forEach(group => {
    if (!Array.isArray(group.items) || !group.items.length) return;
    const section = document.createElement('section');
    section.className = 'skill-group';
    const heading = document.createElement('h3');
    heading.textContent = group.name || 'Skills';
    const chips = document.createElement('div');
    chips.className = 'skill-chips';
    group.items.forEach(skill => {
      const chip = document.createElement('span');
      chip.className = 'skill-chip';
      const icon = document.createElement('i');
      icon.className = skill.icon || 'fas fa-code';
      if (skill.color) icon.style.color = skill.color;
      const label = document.createElement('span');
      label.textContent = skill.label || 'Untitled';
      chip.append(icon, label); chips.appendChild(chip);
    });
    section.append(heading, chips); container.appendChild(section);
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
  // Never read or send credentials from public config. Spotify calls must be
  // made by a server-side integration that keeps its token in a secret.
  if (!sp?.enabled || !sp.serverProxy) return;

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
    try {
      // The proxy endpoint (a server-side worker) holds the Spotify token
      // in a secret and returns the currently-playing JSON. We never ship
      // a token to the client.
      const r = await fetch(sp.serverProxy === true ? '/api/spotify' : sp.serverProxy, {
        headers: { Accept: 'application/json' }
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

      // Album art in the icon area — use DOM methods to prevent XSS
      const iconEl = widget?.querySelector('.spotify-icon');
      if (iconEl && albumArt) {
        const img = document.createElement('img');
        img.src = albumArt;
        img.className = 'spotify-cover';
        img.alt = 'Album cover';
        iconEl.replaceChildren(img);
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
      console.warn('Spotify poll error:', e);
    }
  }

  // Poll immediately, then only while the tab is visible.
  poll();
  S.spotifyStop = createVisibilityInterval(poll, 15000);

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    if (S.spotifyStop) S.spotifyStop();
  });
}

function renderSocials() {
  const con = $('#socials-container');
  if (!con) return;
  con.innerHTML = '';
  (S.cfg.socials || [])
    .filter(s => s.enabled !== false && (s.username || s.url))
    .forEach(s => {
      const div = document.createElement('a');
      const platformName = s.label || 'Contact';
      const isEmail = (s.id || '').toLowerCase() === 'email' || platformName.toLowerCase() === 'email';
      const email = String(s.username || '').trim();
      const href = isEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ? `mailto:${email}`
        : safeExternalUrl(s.url);
      if (!href) return;
      div.href = href;
      if (!isEmail) {
        div.target = '_blank';
        div.rel = 'noopener noreferrer';
      }
      div.className = 'contact-link';
      div.setAttribute('aria-label', `Open ${s.label || 'link'}`);

      const srLeft = document.createElement('span');
      srLeft.className = 'sr-left';

      const iconEl = document.createElement('i');
      iconEl.className = `sr-icon ${s.icon || 'fas fa-link'}`;
      iconEl.style.color = s.color || '';
      iconEl.setAttribute('aria-hidden', 'true');
      srLeft.appendChild(iconEl);

      const labelEl = document.createElement('span');
      const handle = s.username || s.label || 'Link';
      const displayHandle = isEmail ? handle.replace(/^@/, '') : (handle.startsWith('@') ? handle : `@${handle}`);
      const platform = platformName.charAt(0).toUpperCase() + platformName.slice(1);
      labelEl.textContent = `${platform} · ${displayHandle}`;
      srLeft.appendChild(labelEl);
      div.appendChild(srLeft);

      con.appendChild(div);
    });
}

/* ══════════════════════════════════════════
   8. TYPEWRITER
══════════════════════════════════════════ */
function typewriter(el, msgs) {
  if (!el) return;
  if (el._typewriterTimer) {
    clearTimeout(el._typewriterTimer);
    el._typewriterTimer = null;
  }
  if (!msgs || !msgs.length) return;
  let mi = 0, ci = 0, deleting = false, paused = false;

  function tick() {
    if (paused) return;
    const msg = msgs[mi];
    if (!deleting) {
      ci++;
      el.textContent = msg.slice(0, ci);
      if (ci === msg.length) {
        paused = true;
        el._typewriterTimer = setTimeout(() => { deleting = true; paused = false; step(); }, 2200);
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
  function step() { el._typewriterTimer = setTimeout(tick, deleting ? 38 : rand(55, 95)); }
  step();
}

/* ══════════════════════════════════════════
   9. PAGE TITLE CYCLE
══════════════════════════════════════════ */
let _titleCycleTimer = null;
function titleCycle(titles) {
  if (_titleCycleTimer) {
    clearTimeout(_titleCycleTimer);
    _titleCycleTimer = null;
  }
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
        _titleCycleTimer = setTimeout(() => { deleting = true; paused = false; step(); }, 2800);
        return;
      }
    } else {
      ci--;
      document.title = t.slice(0, ci) || '|';
      if (ci === 0) { deleting = false; ti = (ti + 1) % titles.length; }
    }
    step();
  }
  function step() { _titleCycleTimer = setTimeout(tick, deleting ? 34 : rand(60, 100)); }
  _titleCycleTimer = setTimeout(step, 800);
}

/* ══════════════════════════════════════════
   10. MUSIC PLAYER
══════════════════════════════════════════ */
function initMusic() {
  const cfg = S.cfg.music || { enabled: false, defaultVolume: 0.5, tracks: [] };
  cfg.tracks = Array.isArray(cfg.tracks) ? cfg.tracks : [];
  const bar = $('#music-bar');

  if (bar) bar.style.display = 'none'; // always hidden — music plays in background

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
        const cover = normalizeAssetPath(track.cover) || safeExternalUrl(track.cover);
        if (cover) coverEl.style.backgroundImage = `url("${cover.replace(/"/g, '%22')}")`;
        else coverEl.style.backgroundImage = '';
        coverEl.replaceChildren();
      } else {
        coverEl.style.backgroundImage = '';
        const icon = document.createElement('i');
        icon.className = 'fas fa-music';
        coverEl.replaceChildren(icon);
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
      ? '<i class="fas fa-pause" aria-hidden="true"></i>'
      : '<i class="fas fa-play" aria-hidden="true"></i>';
    btn.className = 'music-btn-mini play-btn';
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    btn.setAttribute('aria-pressed', String(playing));
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

  // Buttons — with ARIA labels
  $('#play-pause-btn')?.setAttribute('aria-label', 'Play');
  $('#play-pause-btn')?.setAttribute('aria-pressed', 'false');
  $('#prev-btn')?.setAttribute('aria-label', 'Previous track');
  $('#next-btn')?.setAttribute('aria-label', 'Next track');
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

  // Cache colors — only read getComputedStyle once, update on theme change
  let _accent  = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()  || '#ffffff';
  let _accent2 = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#ffffff';

  // Update cache when theme FAB changes colors
  const observer = new MutationObserver(() => {
    _accent  = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()  || '#ffffff';
    _accent2 = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#ffffff';
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

  // Clean up observer on page unload to prevent memory leak
  window.addEventListener('beforeunload', () => {
    observer.disconnect();
  });

  (function draw() {
    requestAnimationFrame(draw);
    S.analyser.getByteFrequencyData(buf);
    const W = cv.width  = cv.offsetWidth  || 80;
    const H = cv.height = cv.offsetHeight || 24;
    ctx.clearRect(0, 0, W, H);
    const bars = 24;
    const bw = (W / bars) - 1;
    let x = 0;
    for (let i = 0; i < bars; i++) {
      const v  = buf[Math.floor(i / bars * buf.length)];
      const bh = Math.max(2, (v / 255) * H);
      const g  = ctx.createLinearGradient(0, H, 0, H - bh);
      g.addColorStop(0, _accent); g.addColorStop(1, _accent2);
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

  // "tap to enter" on touch devices
  const enterSub = es.querySelector('.enter-sub');
  if (enterSub && window.matchMedia('(hover: none)').matches) {
    enterSub.textContent = 'tap to enter';
  }

  function doEnter() {
    if (S.entered) return;
    S.entered = true;

    if (S.cfg.music?.enabled && S.playPause) {
      try { S.playPause(); } catch (_) {}
    }

    es.classList.add('hidden');

    setTimeout(() => {
      if (mp) mp.classList.add('visible');
      const fab = $('#theme-fab');
      if (fab) fab.classList.add('visible');

      // Stagger child elements for cinematic reveal
      const els = mp.querySelectorAll('.profile-left, .profile-right');
      els.forEach((el, i) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(18px)';
        el.style.transition = `opacity .7s ${i * 0.12 + 0.05}s var(--ease), transform .7s ${i * 0.12 + 0.05}s var(--ease), filter .7s ${i * 0.12 + 0.05}s var(--ease)`;
        el.style.filter = 'blur(6px)';
        requestAnimationFrame(() => {
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
          el.style.filter = 'blur(0)';
        });
      });
    }, 200);
  }

  btn.addEventListener('click', doEnter);
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
    { a:'#ffffff', b:'#ffffff' },
    { a:'#3b82f6', b:'#06b6d4' },
    { a:'#10b981', b:'#34d399' },
    { a:'#f59e0b', b:'#ef4444' },
    { a:'#f97316', b:'#ffffff' },
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

  // Snow/rain are pure DOM animations — cap hard on mobile to save battery
  const isMobile = window.matchMedia('(max-width: 700px)').matches || window.matchMedia('(hover: none)').matches;
  const flakes = isMobile ? 18 : 55;
  for (let i = 0; i < flakes; i++) {
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
   CONSOLE ART — easter egg for the curious
══════════════════════════════════════════ */
function initConsoleArt() {
  const ca = S.cfg.consoleArt;
  if (!ca?.enabled) return;
  const style = 'color:#ffffff;font-family:monospace;font-size:12px;line-height:1.15;white-space:pre;';
  if (ca.art) console.log('%c' + String(ca.art), style);
  if (ca.message) console.log('%c' + ca.message, 'color:#f0f0f5;font-size:14px;font-weight:bold;font-family:monospace;');
  if (ca.subMessage) console.log('%c' + ca.subMessage, 'color:#9a9aa5;font-style:italic;font-family:monospace;');
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

  const ac = S.cfg.theme?.accentColor || '#ffffff';
  const a2 = S.cfg.theme?.accentColorSecondary || '#ffffff';

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
      if (S.perf.hidden) return;
      const frameStart = performance.now();
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
   SECURITY — Block right-click
══════════════════════════════════════════ */
function blockRightClick() {
  // Disable right-click context menu
  document.addEventListener('contextmenu', e => {
    e.preventDefault();
    return false;
  });

  // Disable text selection via double-click
  document.addEventListener('mousedown', e => {
    if (e.detail > 1) e.preventDefault();
  });

  // Prevent drag and copy
  document.addEventListener('dragstart', e => e.preventDefault());
  document.addEventListener('copy', e => {
    if (!e.target.closest('input,textarea')) e.preventDefault();
  });
}

// NOTE: DevTools "blocking" heuristics were removed intentionally.
// The old size-check interval hid <body> (display:none) whenever
// outerHeight - innerHeight > 100px — which is TRUE on most normal browsers
// (tab strip + address bar ≈ 85–110px, more with bookmarks bar or 125% DPI).
// Result: the page flashed white and all CSS animations restarted every ~2s.
// It never actually prevented anyone from opening DevTools anyway.

/* ══════════════════════════════════════════
   MAIN INIT
══════════════════════════════════════════ */
async function init() {
  // Initialize sound system first
  SoundSystem.init();

  initLoading();
  await loadConfig();

  // Initialize dark mode after config
  initDarkMode();

  applyTheme();
  initBackground();
  initBgPattern();
  initCursor();
  initParticles();
  initWeather();
  initConsoleArt();
  initMusic();
  initEditorialReveals();
  initSmoothScrollEffects();
  renderProfile();
  initSpringInteractions();
  initSpotify();
  initKeys();
  initThemeFab();
  initVisualFeatures();
  initDiscord();
  initContextMenu();
  initEasterEggTerminal();

  // Block right-click / native context menu (custom ctx menu takes over)
  blockRightClick();

  // Track page visit
  trackEvent('page_visit', { referrer: document.referrer, timestamp: new Date().toISOString() });

  // Single consolidated mousemove dispatcher — replaces N individual listeners
  if (S._mouseMoveHandlers.length) {
    let queued = false, lastEvent = null;
    document.addEventListener('mousemove', e => {
      lastEvent = e;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (S.perf.hidden || !lastEvent) return;
        for (let i = 0; i < S._mouseMoveHandlers.length; i++) S._mouseMoveHandlers[i](lastEvent);
      });
    }, { passive: true });
  }
}

/* ══════════════════════════════════════════
   16. VISUAL FEATURES ENGINE
   Sub-systems: SVG filter injection, cursor trail,
   3D card tilt + specular, magnetic enter button
══════════════════════════════════════════ */
function initVisualFeatures() {
  _injectSVGFilters();
  if (!window.matchMedia('(hover: none)').matches) {
    _initCursorTrail();
    _initMagneticButton();
  }
  // _initCardTilt() — disabled, CSS effect is off, no point running the mousemove listener
}

/* ── SVG filter injection (grain noise) ── */
function _injectSVGFilters() {
  if (document.getElementById('zade-svg-filters')) return;

  // Hidden SVG with feTurbulence for grain
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'zade-svg-filters';
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
  svg.innerHTML = `
    <defs>
      <filter id="grain" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="linearRGB">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.75"
          numOctaves="4"
          stitchTiles="stitch"
          result="noise"/>
        <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise"/>
        <feComposite in="SourceGraphic" in2="grayNoise" operator="in"/>
      </filter>
    </defs>`;
  document.body.insertAdjacentElement('afterbegin', svg);

  // Grain overlay div (styled by CSS, references #grain filter)
  if (!document.getElementById('grain-overlay')) {
    const div = document.createElement('div');
    div.id = 'grain-overlay';
    document.body.appendChild(div);
  }
}

/* ── Cursor trail spawner ── */
function _initCursorTrail() {
  if (S.prefersReduced) return;
  if (window.matchMedia('(hover: none)').matches) return;

  const trailCfg  = S.cfg.cursor?.trail || {};
  const style     = trailCfg.style || 'dots';
  const maxLen    = trailCfg.length ?? 12;
  const fadeSpeed = trailCfg.fadeSpeed ?? 300;

  document.body.classList.remove('trail-dots','trail-sparkle','trail-comet','trail-rings','trail-none');
  document.body.classList.add('trail-' + style);
  if (style === 'none') return;

  if (trailCfg.color) {
    document.documentElement.style.setProperty('--trail-color', trailCfg.color);
  }

  const pool   = [];
  const active = [];

  function getNode() {
    const el = pool.pop() || document.createElement('div');
    el.className = 'cursor-trail-dot';
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%, -50%) scale(1)';
    document.body.appendChild(el);
    return el;
  }

  function recycleNode(el) {
    el.remove();
    pool.push(el);
  }

  let lastX = -999, lastY = -999;
  const MIN_DIST_SQ = 8 * 8;

  // Register in consolidated mousemove handler
  S._mouseMoveHandlers.push(e => {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (dx*dx + dy*dy < MIN_DIST_SQ) return;
    lastX = e.clientX; lastY = e.clientY;

    const el = getNode();
    el.style.left = e.clientX + 'px';
    el.style.top  = e.clientY + 'px';
    active.push({ el, born: performance.now() });

    while (active.length > maxLen) {
      recycleNode(active.shift().el);
    }
  });

  (function fade() {
    const now = performance.now();
    for (let i = active.length - 1; i >= 0; i--) {
      const item = active[i];
      const t    = Math.min((now - item.born) / fadeSpeed, 1);
      item.el.style.opacity = (1 - t).toFixed(3);
      item.el.style.transform = `translate(-50%, -50%) scale(${1 - t * 0.5})`;
      if (t >= 1) { recycleNode(item.el); active.splice(i, 1); }
    }
    requestAnimationFrame(fade);
  })();
}

/* ── 3D Card tilt + specular highlight ── */
function _initCardTilt() {
  const card = document.querySelector('.profile-left');
  if (!card) return;

  // Inject specular highlight div
  let spec = card.querySelector('.specular-highlight');
  if (!spec) {
    spec = document.createElement('div');
    spec.className = 'specular-highlight';
    card.appendChild(spec);
  }

  const MAX_TILT = 8; // degrees max tilt each axis

  function onMove(e) {
    const rect  = card.getBoundingClientRect();
    const cx    = rect.left + rect.width  / 2;
    const cy    = rect.top  + rect.height / 2;
    const dx    = (e.clientX - cx) / (rect.width  / 2); // -1 to 1
    const dy    = (e.clientY - cy) / (rect.height / 2); // -1 to 1

    const tiltX = (-dy * MAX_TILT).toFixed(2) + 'deg';
    const tiltY = ( dx * MAX_TILT).toFixed(2) + 'deg';

    card.style.setProperty('--tilt-x', tiltX);
    card.style.setProperty('--tilt-y', tiltY);

    // Specular highlight follows cursor within card
    const relX = ((e.clientX - rect.left) / rect.width  * 100).toFixed(1) + '%';
    const relY = ((e.clientY - rect.top)  / rect.height * 100).toFixed(1) + '%';
    card.style.setProperty('--spec-x', relX);
    card.style.setProperty('--spec-y', relY);
    if (spec) {
      spec.style.setProperty('--spec-x', relX);
      spec.style.setProperty('--spec-y', relY);
    }
  }

  function onLeave() {
    card.style.setProperty('--tilt-x', '0deg');
    card.style.setProperty('--tilt-y', '0deg');
    card.style.setProperty('--spec-x', '50%');
    card.style.setProperty('--spec-y', '50%');
  }

  card.addEventListener('mousemove', onMove);
  card.addEventListener('mouseleave', onLeave);
}

/* ── Magnetic enter button ── */
function _initMagneticButton() {
  const btn = document.querySelector('.enter-btn');
  if (!btn) return;

  const STRENGTH = 0.35;

  S._mouseMoveHandlers.push(e => {
    const rect = btn.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;
    const dx   = e.clientX - cx;
    const dy   = e.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const RADIUS = Math.max(rect.width, rect.height) * 1.4;

    if (dist < RADIUS) {
      const pull = (1 - dist / RADIUS) * STRENGTH;
      btn.style.setProperty('--mx', (dx * pull).toFixed(1) + 'px');
      btn.style.setProperty('--my', (dy * pull).toFixed(1) + 'px');
    } else {
      btn.style.setProperty('--mx', '0px');
      btn.style.setProperty('--my', '0px');
    }
  });

  btn.addEventListener('mouseleave', () => {
    btn.style.setProperty('--mx', '0px');
    btn.style.setProperty('--my', '0px');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/* ══════════════════════════════════════════
   17. DISCORD LANYARD PRESENCE
   WebSocket connection to wss://api.lanyard.rest/socket
   - Real-time status, activity, Spotify via Lanyard
   - Discord avatar synced to profile picture
   - Reconnects on disconnect with exponential backoff
══════════════════════════════════════════ */
function initDiscord() {
  const userId = S.cfg.discord?.userId || '1246068508039708672';
  if (!userId) return;

  const panel     = $('#discord-panel');
  const card      = $('#dc-card');
  const dcAvWrap  = $('#dc-avatar-wrap-inner');
  const statusDot = $('#dc-status-dot');
  const dcUser    = $('#dc-username');
  const dcStatus  = $('#dc-status-text');
  const actPanel  = $('#dc-activity');
  const actType   = $('#dc-act-type');
  const actName   = $('#dc-act-name');
  const actDetail = $('#dc-act-detail');
  const actState  = $('#dc-act-state');
  const actImg    = $('#dc-act-img');
  const actSmall  = $('#dc-act-small-img');
  const actPH     = $('#dc-act-placeholder');
  const actElapsed= $('#dc-act-elapsed');
  const spPanel   = $('#dc-spotify');
  const spCover   = $('#dc-sp-cover');
  const spTrack   = $('#dc-sp-track');
  const spArtist  = $('#dc-sp-artist');
  if (!panel) return;

  panel.style.display = 'flex';

  const STATUS_TEXT = {
    online:  'online',
    idle:    'away',
    dnd:     'do not disturb',
    offline: 'offline',
  };

  const ACTIVITY_TYPE = {
    0: 'Playing',
    1: 'Streaming',
    2: 'Listening to',
    3: 'Watching',
    5: 'Competing in',
  };

  let elapsedTimer = null;
  let actStartMs   = null;
  let ws           = null;
  let heartbeatInterval = null;
  let reconnectDelay    = 1000;
  let dead = false;

  /* ── Elapsed timer ── */
  function startElapsed(timestampMs) {
    actStartMs = timestampMs;
    clearInterval(elapsedTimer);
    elapsedTimer = setInterval(() => {
      if (!actStartMs || !actElapsed) return;
      const s = Math.floor((Date.now() - actStartMs) / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      actElapsed.textContent = h > 0
        ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
        : `${m}:${String(sec).padStart(2,'0')}`;
    }, 1000);
  }

  function stopElapsed() {
    clearInterval(elapsedTimer);
    actStartMs = null;
    if (actElapsed) actElapsed.textContent = '';
  }

  /* ── Lanyard CDN asset URL ── */
  function lanyardAsset(appId, assetId) {
    if (!assetId) return '';
    if (assetId.startsWith('mp:external/')) {
      // External image (e.g. Spotify cover)
      const path = assetId.replace('mp:external/', '');
      return `https://media.discordapp.net/external/${path}`;
    }
    return `https://cdn.discordapp.com/app-assets/${appId}/${assetId}.png`;
  }

  /* ── Apply Discord avatar to profile picture ── */
  function applyDiscordAvatar(avatarHash, userId) {
    if (!avatarHash) return;
    const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
    const url = `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=256`;

    // Update the profile avatar wrap on the page
    const wrap = $('#avatar-wrap');
    if (!wrap) return;
    let img = wrap.querySelector('img.avatar-img');
    if (!img) {
      img = document.createElement('img');
      img.className = 'avatar-img';
      img.alt = 'avatar';
      const ring = wrap.querySelector('.avatar-ring');
      if (ring) ring.insertAdjacentElement('afterend', img);
      else wrap.insertBefore(img, wrap.firstChild);
    }
    if (img.src !== url) {
      img.style.transition = 'opacity 0.4s ease';
      img.style.opacity = '0';
      img.onerror = () => img.remove();
      img.onload = () => { img.style.opacity = '1'; };
      img.src = url;
    }

    // Update Discord panel avatar too
    if (dcAvWrap) {
      const existing = dcAvWrap.querySelector('img');
      if (existing) {
        if (existing.src !== url) existing.src = url;
      } else {
        const dcImg = document.createElement('img');
        dcImg.className = 'dc-avatar';
        dcImg.alt = 'discord avatar';
        dcImg.onerror = () => dcImg.remove();
        dcImg.src = url;
        dcAvWrap.parentElement.replaceChild(dcImg, dcAvWrap);
      }
    }
  }

  /* ── Render presence data ── */
  function renderPresence(data) {
    if (!data) return;
    card?.classList.remove('dc-connecting');

    const status = data.discord_status || 'offline';

    // Status dot
    if (statusDot) {
      statusDot.className = `dc-status-dot ${status}`;
    }

    // Username
    const name = data.discord_user?.global_name || data.discord_user?.username || 'zade';
    if (dcUser) dcUser.textContent = name;
    if (dcStatus) dcStatus.textContent = STATUS_TEXT[status] || status;

    // Avatar sync
    const avatarHash = data.discord_user?.avatar;
    const uid = data.discord_user?.id || userId;
    if (avatarHash) applyDiscordAvatar(avatarHash, uid);

    // Clear previous activity state
    actPanel?.classList.remove('show');
    spPanel?.classList.remove('show');
    stopElapsed();

    // Spotify via Lanyard (if Spotify widget not already active)
    const sp = data.spotify;
    // Spotify tokens never live in the public config; the widget is driven
    // entirely by the /api/spotify server proxy.
    const spotifyWidgetActive = S.cfg.spotify?.enabled;
    if (sp && !spotifyWidgetActive) {
      if (spTrack)  spTrack.textContent  = sp.song  || '—';
      if (spArtist) spArtist.textContent = sp.artist || '—';
      if (spCover && sp.album_art_url) {
        spCover.src = sp.album_art_url;
        spCover.style.display = 'block';
      }
      spPanel?.classList.add('show');
    }

    // Activities — pick most interesting (not Spotify type 2 if we showed it above)
    const activities = (data.activities || []).filter(a => {
      if (a.type === 4) return false; // custom status — skip
      if (a.id === 'spotify:1') return false; // Spotify handled above
      return true;
    });

    const act = activities[0];
    if (act) {
      const typeLabel = ACTIVITY_TYPE[act.type] || 'Playing';
      if (actType)   actType.textContent   = typeLabel;
      if (actName)   actName.textContent   = act.name || '—';
      if (actDetail) actDetail.textContent = act.details || '';
      if (actState)  actState.textContent  = act.state  || '';

      // Large image
      const largeKey = act.assets?.large_image;
      const appId    = act.application_id;
      const imgUrl   = largeKey ? lanyardAsset(appId, largeKey) : '';

      if (imgUrl && actImg) {
        actImg.src = imgUrl;
        actImg.style.display = 'block';
        if (actPH) actPH.style.display = 'none';
      } else {
        if (actImg) actImg.style.display = 'none';
        if (actPH) {
          actPH.style.display = 'flex';
          const emojiMap = { 0:'🎮', 1:'📺', 2:'🎵', 3:'👁️', 5:'🏆' };
          actPH.textContent = emojiMap[act.type] || '🎮';
        }
      }

      // Small image (app icon overlay)
      const smallKey = act.assets?.small_image;
      const smallUrl = smallKey ? lanyardAsset(appId, smallKey) : '';
      if (actSmall) {
        if (smallUrl) { actSmall.src = smallUrl; actSmall.style.display = 'block'; }
        else actSmall.style.display = 'none';
      }

      // Elapsed time
      if (act.timestamps?.start) {
        startElapsed(act.timestamps.start);
      }

      actPanel?.classList.add('show');
    }
  }

  /* ── WebSocket connect ── */
  function connect() {
    if (dead) return;
    ws = new WebSocket('wss://api.lanyard.rest/socket');

    ws.addEventListener('open', () => {
      reconnectDelay = 1000; // reset backoff on success
    });

    ws.addEventListener('message', e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      switch (msg.op) {
        case 1: { // Hello — start heartbeat and identify
          const interval = msg.d?.heartbeat_interval || 30000;
          clearInterval(heartbeatInterval);
          heartbeatInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ op: 3 }));
            }
          }, interval);

          // Identify
          ws.send(JSON.stringify({
            op: 2,
            d: { subscribe_to_id: userId }
          }));
          break;
        }

        case 0: { // Event
          const t = msg.t;
          const d = msg.d;
          if (t === 'INIT_STATE' || t === 'PRESENCE_UPDATE') {
            // INIT_STATE is { [userId]: presenceData }
            // PRESENCE_UPDATE is the presenceData directly
            const presence = t === 'INIT_STATE' ? d[userId] : d;
            if (presence) renderPresence(presence);
          }
          break;
        }
      }
    });

    ws.addEventListener('close', () => {
      clearInterval(heartbeatInterval);
      if (!dead) {
        setTimeout(connect, Math.min(reconnectDelay, 30000));
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      }
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }

  // Kick off
  connect();

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    dead = true;
    clearInterval(heartbeatInterval);
    clearInterval(elapsedTimer);
    ws?.close();
  });
}

/* ══════════════════════════════════════════
   18. CUSTOM RIGHT-CLICK CONTEXT MENU
   Full keyboard navigation, auto-bounds check,
   closes on Escape / outside click / scroll
══════════════════════════════════════════ */
function initContextMenu() {
  const menu = $('#ctx-menu');
  if (!menu) return;

  let focusedIndex = -1;
  let isOpen = false;
  let lastTrigger = null; // element to restore focus to on close

  /* ── Menu items definition ── */
  function buildItems() {
    return [
      { label: 'Profile', icon: 'fa-user', section: true },
      {
        label: 'Copy Profile Link',
        icon: 'fa-link',
        action: () => {
          navigator.clipboard?.writeText(window.location.href).catch(() => {});
          toast('🔗 Profile link copied!');
        }
      },
      {
        label: 'Copy Discord',
        icon: 'fa-discord fab',
        action: () => {
          const dc = (S.cfg.socials || []).find(s => s.id === 'discord');
          if (dc) {
            navigator.clipboard?.writeText(dc.username || dc.url).catch(() => {});
            toast('💬 Discord copied!');
          } else {
            toast('No Discord set');
          }
        }
      },
      { sep: true },
      { label: 'Site', icon: 'fa-globe', section: true },
      {
        label: 'Admin Panel',
        icon: 'fa-screwdriver-wrench',
        cls: 'accent',
        action: () => { window.location.href = 'admin.html'; }
      },
    ];
  }

  /* ── Render menu at position ── */
  function openAt(x, y) {
    lastTrigger = document.activeElement;
    const items = buildItems();
    menu.innerHTML = '';
    focusedIndex = -1;

    const clickableItems = [];

    items.forEach(item => {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep';
        sep.setAttribute('role', 'separator');
        menu.appendChild(sep);
        return;
      }
      if (item.section) {
        const lbl = document.createElement('div');
        lbl.className = 'ctx-section-lbl';
        lbl.textContent = item.label;
        menu.appendChild(lbl);
        return;
      }

      const el = document.createElement('div');
      el.className = 'ctx-item' + (item.cls ? ' ' + item.cls : '');
      el.setAttribute('role', 'menuitem');
      el.setAttribute('tabindex', '-1');

      const iconClass = item.icon.includes('fab') ? item.icon : 'fas ' + item.icon;
      el.innerHTML = `<i class="${iconClass}"></i><span class="ctx-label">${item.label}</span>${item.kbd ? `<span class="ctx-kbd">${item.kbd}</span>` : ''}`;

      el.addEventListener('click', () => {
        closeMenu();
        item.action?.();
      });
      el.addEventListener('mouseenter', () => {
        setFocus(clickableItems.indexOf(el));
      });

      menu.appendChild(el);
      clickableItems.push(el);
    });

    // Store for keyboard nav
    menu._items = clickableItems;

    // Position — keep inside viewport
    menu.style.left = '0px';
    menu.style.top  = '0px';
    menu.style.transformOrigin = 'top left';
    menu.classList.add('open');
    isOpen = true;

    const mw = menu.offsetWidth  || 220;
    const mh = menu.offsetHeight || 300;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let cx = x;
    let cy = y;
    let flipX = false;
    let flipY = false;
    if (cx + mw > vw - 8) { cx = vw - mw - 8; flipX = true; }
    if (cy + mh > vh - 8) { cy = vh - mh - 8; flipY = true; }
    if (cx < 8) { cx = 8; flipX = false; }
    if (cy < 8) { cy = 8; flipY = false; }
    menu.style.transformOrigin = `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}`;

    menu.style.left = cx + 'px';
    menu.style.top  = cy + 'px';
  }

  function closeMenu() {
    if (!isOpen) return;
    menu.classList.remove('open');
    isOpen = false;
    focusedIndex = -1;
    if (lastTrigger && document.contains(lastTrigger)) {
      try { lastTrigger.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
    lastTrigger = null;
  }

  function setFocus(idx) {
    const items = menu._items || [];
    items.forEach(el => el.classList.remove('focused'));
    focusedIndex = idx;
    if (idx >= 0 && idx < items.length) {
      items[idx].classList.add('focused');
      items[idx].focus();
    }
  }

  /* ── Event listeners ── */
  document.addEventListener('contextmenu', e => {
    // Skip on admin page or input elements
    if (e.target.closest('input,textarea,select,a')) return;
    e.preventDefault();
    openAt(e.clientX, e.clientY);
  });

  document.addEventListener('click', e => {
    if (isOpen && !menu.contains(e.target)) closeMenu();
  });

  document.addEventListener('keydown', e => {
    if (!isOpen) return;

    const items = menu._items || [];
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closeMenu();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setFocus(Math.min(focusedIndex + 1, items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocus(focusedIndex <= 0 ? items.length - 1 : focusedIndex - 1);
        break;
      case 'Home':
        e.preventDefault();
        setFocus(0);
        break;
      case 'End':
        e.preventDefault();
        setFocus(items.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < items.length) {
          items[focusedIndex].click();
        }
        break;
    }
  });

  // Close on scroll (menu would be displaced)
  window.addEventListener('scroll', () => { if (isOpen) closeMenu(); }, true);

  // Close on resize
  window.addEventListener('resize', () => { if (isOpen) closeMenu(); });
}

/* ══════════════════════════════════════════
   19. EASTER EGG TERMINAL (Feature 15)
   Type any key sequence at 8+ chars/sec on
   the main page — a secret terminal appears.
   Commands: help, whoami, ls, sudo, hack,
   matrix, theme, clear, exit
══════════════════════════════════════════ */
function initEasterEggTerminal() {
  // Only active after entering the site
  const SPEED_THRESHOLD = 120; // ms between keystrokes to count as "fast"
  const MIN_KEYS = 5; // minimum fast keystrokes to trigger
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let keyTimes = [];
  let terminalOpen = false;
  let closeTimer = null;
  let outputTimers = [];
  let termHistory = [];
  let histIdx = -1;

  const RESPONSES = {
    help:    ['available commands:', '  whoami   — who are you really', '  ls       — list everything', '  sudo     — try your luck', '  hack     — attempt intrusion', '  matrix   — toggle matrix mode', '  theme    — cycle accent color', '  clear    — clear terminal', '  exit     — close this terminal'],
    whoami:  ['zade. developer. human (probably).'],
    ls:      ['drwxr-xr-x  music/', 'drwxr-xr-x  assets/', '-rw-r--r--  config.json', '-rw-r--r--  soul.exe  [CORRUPTED]', '-rw-r--r--  secrets.txt  [ENCRYPTED]', '-rwxr-xr-x  vibe.sh'],
    sudo:    ['[sudo] password for zade: ', '...', 'sudo: you are not in the sudoers file.', 'this incident will be reported.'],
    hack:    ['initializing...', 'connecting to mainframe...', '████████░░ 80%', 'access denied.', 'nice try though.'],
    matrix:  ['__MATRIX_MODE__'],
    theme:   ['__CYCLE_THEME__'],
    clear:   ['__CLEAR__'],
    exit:    ['__EXIT__'],
  };

  /* ── Build terminal DOM ── */
  function buildTerminal() {
    const existing = document.getElementById('egg-terminal');
    if (existing) {
      // Terminal is mid-close animation — cancel the close and reuse it
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
      outputTimers.forEach(clearTimeout); outputTimers = [];
      existing.style.opacity = '1';
      existing.style.transform = 'translateX(-50%) translateY(0)';
      existing.querySelector('#egg-input')?.focus();
      terminalOpen = true;
      return;
    }
    outputTimers.forEach(clearTimeout); outputTimers = [];

    const el = document.createElement('div');
    el.id = 'egg-terminal';
    el.style.cssText = `
      position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(20px);
      width:min(600px,92vw);max-height:360px;
      background:rgba(4,4,10,0.97);
      border:1px solid rgba(255,255,255,0.35);
      border-radius:14px;overflow:hidden;
      box-shadow:0 0 60px rgba(255,255,255,0.2),0 24px 60px rgba(0,0,0,0.8);
      z-index:99995;
      opacity:0;transition:opacity .3s ease,transform .3s ease;
      font-family:'JetBrains Mono','Courier New',monospace;
    `;

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:7px;padding:10px 14px;background:rgba(255,255,255,.03);border-bottom:1px solid rgba(255,255,255,.15);">
        <span style="width:11px;height:11px;border-radius:50%;background:#ff5f57;"></span>
        <span style="width:11px;height:11px;border-radius:50%;background:#febc2e;"></span>
        <span style="width:11px;height:11px;border-radius:50%;background:#28c840;"></span>
        <span style="flex:1;text-align:center;font-size:.65rem;color:rgba(240,240,245,.25);margin-left:-60px;">zade@arch: ~ [secret terminal]</span>
      </div>
      <div id="egg-output" style="padding:14px 16px;max-height:260px;overflow-y:auto;font-size:.72rem;line-height:1.85;color:#22c55e;"></div>
      <div style="display:flex;align-items:center;gap:8px;padding:8px 16px;border-top:1px solid rgba(255,255,255,.1);">
        <span style="color:#ffffff;font-size:.72rem;font-weight:700;">zade@arch ~ $</span>
        <input id="egg-input" type="text" autocomplete="off" spellcheck="false"
          style="flex:1;background:none;border:none;outline:none;color:#f0f0f5;font-family:inherit;font-size:.72rem;caret-color:#ffffff;"
          placeholder="type a command..."/>
      </div>
    `;

    document.body.appendChild(el);

    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });

    const input = el.querySelector('#egg-input');
    const output = el.querySelector('#egg-output');

    // Welcome message
    appendOutput(output, ['you found the secret terminal.', 'type <span style="color:#ffffff">help</span> for commands.', '']);

    input.focus();
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const cmd = input.value.trim().toLowerCase();
        input.value = '';
        if (cmd) { termHistory.unshift(cmd); histIdx = -1; }
        handleCommand(cmd, output);
      }
      if (e.key === 'ArrowUp') {
        histIdx = Math.min(histIdx + 1, termHistory.length - 1);
        if (termHistory[histIdx]) input.value = termHistory[histIdx];
      }
      if (e.key === 'ArrowDown') {
        histIdx = Math.max(histIdx - 1, -1);
        input.value = histIdx >= 0 ? termHistory[histIdx] : '';
      }
      if (e.key === 'Escape') closeTerminal();
      e.stopPropagation();
    });

    terminalOpen = true;
  }

  function appendOutput(output, lines) {
    lines.forEach((line, i) => {
      outputTimers.push(setTimeout(() => {
        const d = document.createElement('div');
        d.innerHTML = line;
        output.appendChild(d);
        output.scrollTop = output.scrollHeight;
      }, i * 60));
    });
  }

  function handleCommand(cmd, output) {
    // Echo command
    const echo = document.createElement('div');
    echo.innerHTML = `<span style="color:#ffffff">zade@arch ~ $</span> <span style="color:#f0f0f5">${esc(cmd)}</span>`;
    output.appendChild(echo);

    const resp = RESPONSES[cmd] || [`command not found: ${esc(cmd)}`, 'try <span style="color:#ffffff">help</span>'];

    if (resp[0] === '__CLEAR__') { output.innerHTML = ''; return; }
    if (resp[0] === '__EXIT__')  { closeTerminal(); return; }
    if (resp[0] === '__MATRIX_MODE__') {
      document.body.classList.toggle('matrix-mode');
      appendOutput(output, [document.body.classList.contains('matrix-mode') ? 'matrix mode activated.' : 'matrix mode deactivated.']);
      return;
    }
    if (resp[0] === '__CYCLE_THEME__') {
      document.getElementById('theme-fab')?.click();
      appendOutput(output, ['theme cycled.']);
      return;
    }

    appendOutput(output, resp);
  }

  function closeTerminal() {
    const el = document.getElementById('egg-terminal');
    if (!el) return;
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(20px)';
    terminalOpen = false; // release the key detector immediately
    outputTimers.forEach(clearTimeout); outputTimers = [];
    closeTimer = setTimeout(() => { el.remove(); closeTimer = null; }, 300);
  }

  /* ── Key speed detector ── */
  document.addEventListener('keydown', e => {
    if (!S.entered) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (terminalOpen) return;
    if (e.repeat) return; // ignore auto-repeat
    // Ignore modifier-only keys
    if (['Shift','Control','Alt','Meta','CapsLock','Tab','Escape'].includes(e.key)) return;

    const now = performance.now();
    keyTimes.push(now);

    // Keep only last 8 keystrokes
    if (keyTimes.length > 8) keyTimes.shift();

    // Check if all gaps are below threshold
    if (keyTimes.length >= MIN_KEYS) {
      let allFast = true;
      for (let i = 1; i < keyTimes.length; i++) {
        if (keyTimes[i] - keyTimes[i-1] > SPEED_THRESHOLD) { allFast = false; break; }
      }
      if (allFast) {
        keyTimes = [];
        buildTerminal();
      }
    }
  });
}

function renderProjects() {
  const con = $('#projects-container');
  if (!con) return;
  const projects = Array.isArray(S.cfg.projects) ? S.cfg.projects : [];
  con.innerHTML = '';
  if (!projects.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-work';
    empty.textContent = 'Nothing to show here yet. I’m working on it.';
    con.appendChild(empty);
    return;
  }
  projects.forEach((project, index) => {
    const article = document.createElement('article'); article.className = 'project' + (index % 2 ? ' reverse' : '');
    const copy = document.createElement('div'); copy.className = 'project-copy';
    copy.innerHTML = `<span class="project-number">${String(index + 1).padStart(2, '0')}</span><h3></h3><p class="project-description"></p><p class="project-tech"></p>`;
    copy.querySelector('h3').textContent = project.name || project.title || 'Untitled project';
    copy.querySelector('.project-description').textContent = project.description || '';
    copy.querySelector('.project-tech').textContent = Array.isArray(project.technologies) ? project.technologies.join(' · ') : (project.technology || '');
    const projectUrl = safeExternalUrl(project.url);
    if (projectUrl) { const link = document.createElement('a'); link.className = 'project-link'; link.href = projectUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'View project ↗'; copy.appendChild(link); }
    const media = document.createElement('div'); media.className = 'project-media';
    const image = normalizeAssetPath(project.image || project.screenshot || '');
    if (image) { const img = document.createElement('img'); img.src = image; img.alt = `${project.name || 'Project'} preview`; img.loading = 'lazy'; img.decoding = 'async'; media.appendChild(img); } else { const placeholder = document.createElement('div'); placeholder.className = 'project-placeholder'; placeholder.textContent = 'Preview'; media.appendChild(placeholder); }
    article.append(copy, media); con.appendChild(article);
  });
}

function initSpringInteractions() {
  if (!window.ZazaMotion) return;
  ZazaMotion.bind('button, .contact-link, .project-link, .badge, .scroll-cue, .theme-fab, .music-btn-mini', { preset: 'snappy' });
  ZazaMotion.reveal('.reveal');
}

function initEditorialReveals() {
  const items = $$('.reveal');
  if (!('IntersectionObserver' in window)) { items.forEach(el => el.classList.add('in-view')); return; }
  const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('in-view'); observer.unobserve(entry.target); } }), {threshold:.12});
  items.forEach(item => observer.observe(item));
}

function initSmoothScrollEffects() {
  const sections = $$('.editorial-section');
  if (!sections.length) return;
  let frame = 0;
  const update = () => {
    frame = 0;
    if (S.perf.hidden || S.prefersReduced) return;
    const center = window.innerHeight * .52;
    sections.forEach(section => {
      const rect = section.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height * .5 - center);
      const progress = Math.max(0, 1 - distance / (window.innerHeight * 1.35));
      section.style.setProperty('--section-focus', progress.toFixed(3));
    });
  };
  const requestUpdate = () => { if (!frame) frame = requestAnimationFrame(update); };
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate, { passive: true });
  requestUpdate();
}
