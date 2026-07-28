/* ============================================================
   ZAZA — Premium Bio-Link | app.js
   Main application logic: config loader, music, particles,
   cursor, typewriter, tilt, visualizer, weather, counters
   ============================================================ */

'use strict';

/* ── Global State ── */
const State = {
  config: null,
  entered: false,
  musicPlaying: false,
  currentTrack: 0,
  audioCtx: null,
  analyser: null,
  sourceNode: null,
  gainNode: null,
  animFrames: {},
  cursorX: 0, cursorY: 0,
  followerX: 0, followerY: 0,
  tiltEnabled: true,
};

/* ── Utility Helpers ── */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (min, max) => Math.random() * (max - min) + min;

/* ── Config Loader ── */
async function loadConfig() {
  try {
    const res = await fetch('./config.json?v=' + Date.now());
    if (!res.ok) throw new Error('Config fetch failed');
    State.config = await res.json();
  } catch (e) {
    console.warn('Config load failed, using defaults:', e);
    State.config = getDefaultConfig();
  }
}

function getDefaultConfig() {
  return {
    profile: { username: 'zaza', displayName: 'zaza', bio: 'living in the moment.', avatar: '', status: 'online', statusMessages: ['just vibing 🎵'], location: '', joinDate: '2024' },
    theme: { accentColor: '#a855f7', accentColorSecondary: '#ec4899', particleCount: 80, snowEnabled: false, rainEnabled: false },
    background: { videoUrl: '', overlayOpacity: 0.6 },
    music: { enabled: true, autoPlay: false, defaultVolume: 0.5, tracks: [] },
    socials: [],
    stats: { showVisitorCount: true, visitorCount: 1, showMemberSince: true },
    discord: { enabled: false, userId: '', showWidget: false },
    spotify: { enabled: false, fallbackText: 'not listening to anything rn' },
    cursor: { enabled: true, trailEnabled: true, color: '#a855f7' },
    seo: { title: 'zaza', description: '' },
  };
}

/* ── Apply Theme ── */
function applyTheme(cfg) {
  const root = document.documentElement;
  root.style.setProperty('--accent', cfg.theme.accentColor);
  root.style.setProperty('--accent2', cfg.theme.accentColorSecondary);
  root.style.setProperty('--accent-glow', hexToRgba(cfg.theme.accentColor, 0.35));
  root.style.setProperty('--accent2-glow', hexToRgba(cfg.theme.accentColorSecondary, 0.25));
  // Update meta theme-color
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = cfg.theme.accentColor;
  // Page title
  if (cfg.seo?.title) document.title = cfg.seo.title;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ── Loading Screen ── */
function initLoadingScreen() {
  const screen = $('#loading-screen');
  const bar = $('.loader-bar');
  const text = $('.loader-text');
  if (!screen) return;

  const steps = ['initializing...', 'loading assets...', 'almost ready...', 'done.'];
  let progress = 0;
  let step = 0;

  const tick = setInterval(() => {
    progress += rand(12, 28);
    if (progress > 100) progress = 100;
    if (bar) bar.style.width = progress + '%';

    const idx = Math.floor((progress / 100) * steps.length);
    if (text && idx < steps.length && idx !== step) {
      step = idx;
      text.textContent = steps[step];
    }

    if (progress >= 100) {
      clearInterval(tick);
      setTimeout(() => screen.classList.add('hidden'), 400);
    }
  }, 120);
}

/* ── Background Video ── */
function initBackground(cfg) {
  const video = $('#bg-video');
  if (video && cfg.background?.videoUrl) {
    video.src = cfg.background.videoUrl;
    video.load();
    video.style.display = 'block';
  } else if (video) {
    video.style.display = 'none';
  }
  const overlay = $('#bg-overlay');
  if (overlay && cfg.background?.overlayOpacity !== undefined) {
    overlay.style.opacity = cfg.background.overlayOpacity;
  }
}

/* ── Custom Cursor ── */
function initCursor(cfg) {
  if (!cfg.cursor?.enabled) return;
  const cursor = $('#cursor');
  const follower = $('#cursor-follower');
  if (!cursor || !follower) return;

  // Update cursor color from config
  document.documentElement.style.setProperty('--cursor-color', cfg.cursor.color || cfg.theme.accentColor);

  document.addEventListener('mousemove', e => {
    State.cursorX = e.clientX;
    State.cursorY = e.clientY;
    cursor.style.left = e.clientX + 'px';
    cursor.style.top  = e.clientY + 'px';
  });

  // Smooth follower with RAF
  function animateFollower() {
    State.followerX = lerp(State.followerX, State.cursorX, 0.12);
    State.followerY = lerp(State.followerY, State.cursorY, 0.12);
    follower.style.left = State.followerX + 'px';
    follower.style.top  = State.followerY + 'px';
    requestAnimationFrame(animateFollower);
  }
  animateFollower();

  // Hover effect on interactive elements
  const interactiveEls = 'a, button, [data-hover], .social-btn, .music-btn, .enter-btn, .admin-nav-item';
  document.addEventListener('mouseover', e => {
    if (e.target.closest(interactiveEls)) {
      cursor.classList.add('hover');
      follower.classList.add('hover');
    }
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest(interactiveEls)) {
      cursor.classList.remove('hover');
      follower.classList.remove('hover');
    }
  });
  document.addEventListener('mousedown', () => cursor.classList.add('click'));
  document.addEventListener('mouseup', () => cursor.classList.remove('click'));

  // Mouse-follow light
  const light = $('#mouse-light');
  if (light) {
    document.addEventListener('mousemove', e => {
      light.style.left = e.clientX + 'px';
      light.style.top  = e.clientY + 'px';
    });
  }
}

/* ── Particles ── */
function initParticles(cfg) {
  const canvas = $('#particles-canvas');
  if (!canvas) return;
  const ctx2d = canvas.getContext('2d');
  const count = cfg.theme?.particleCount || 80;
  const accent = cfg.theme?.accentColor || '#a855f7';

  let W, H, particles = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function hexToComponents(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return { r, g, b };
  }

  const accentRGB = hexToComponents(accent);

  class Particle {
    constructor() { this.reset(true); }
    reset(init = false) {
      this.x = rand(0, W);
      this.y = init ? rand(0, H) : H + 10;
      this.size = rand(0.5, 2.5);
      this.speedX = rand(-0.4, 0.4);
      this.speedY = rand(-0.6, -0.15);
      this.opacity = rand(0.1, 0.5);
      this.life = 1;
      this.decay = rand(0.0008, 0.002);
      // Occasionally use accent2 color
      const useAccent2 = Math.random() > 0.7;
      if (useAccent2) {
        const a2 = hexToComponents(cfg.theme?.accentColorSecondary || '#ec4899');
        this.r = a2.r; this.g = a2.g; this.b = a2.b;
      } else {
        this.r = accentRGB.r; this.g = accentRGB.g; this.b = accentRGB.b;
      }
    }
    update() {
      this.x += this.speedX;
      this.y += this.speedY;
      this.life -= this.decay;
      if (this.life <= 0 || this.y < -10) this.reset();
    }
    draw() {
      ctx2d.save();
      ctx2d.globalAlpha = this.opacity * this.life;
      ctx2d.fillStyle = `rgb(${this.r},${this.g},${this.b})`;
      ctx2d.shadowColor = `rgb(${this.r},${this.g},${this.b})`;
      ctx2d.shadowBlur = 4;
      ctx2d.beginPath();
      ctx2d.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.restore();
    }
  }

  function spawnParticles() {
    particles = Array.from({ length: count }, () => new Particle());
  }

  function drawConnections() {
    const maxDist = 100;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < maxDist) {
          const alpha = (1 - dist / maxDist) * 0.08;
          ctx2d.strokeStyle = `rgba(${accentRGB.r},${accentRGB.g},${accentRGB.b},${alpha})`;
          ctx2d.lineWidth = 0.5;
          ctx2d.beginPath();
          ctx2d.moveTo(particles[i].x, particles[i].y);
          ctx2d.lineTo(particles[j].x, particles[j].y);
          ctx2d.stroke();
        }
      }
    }
  }

  function loop() {
    ctx2d.clearRect(0, 0, W, H);
    drawConnections();
    particles.forEach(p => { p.update(); p.draw(); });
    State.animFrames.particles = requestAnimationFrame(loop);
  }

  resize();
  spawnParticles();
  loop();
  window.addEventListener('resize', () => { resize(); });
}

/* ── Typewriter Effect ── */
function initTypewriter(messages) {
  const el = $('#status-typewriter');
  if (!el || !messages?.length) return;

  let msgIdx = 0, charIdx = 0, deleting = false, paused = false;

  function type() {
    if (paused) return;
    const msg = messages[msgIdx];
    if (!deleting) {
      charIdx++;
      el.textContent = msg.slice(0, charIdx);
      if (charIdx === msg.length) {
        paused = true;
        setTimeout(() => { deleting = true; paused = false; tick(); }, 2400);
        return;
      }
    } else {
      charIdx--;
      el.textContent = msg.slice(0, charIdx);
      if (charIdx === 0) {
        deleting = false;
        msgIdx = (msgIdx + 1) % messages.length;
      }
    }
    tick();
  }

  function tick() {
    const delay = deleting ? 40 : rand(60, 100);
    setTimeout(type, delay);
  }

  tick();
}

/* ── Profile Render ── */
function renderProfile(cfg) {
  // Username
  const unEl = $('#profile-username');
  if (unEl) unEl.textContent = cfg.profile.displayName || cfg.profile.username;

  // Avatar
  const avatarWrap = $('#avatar-wrap');
  if (avatarWrap) {
    if (cfg.profile.avatar) {
      const img = document.createElement('img');
      img.src = cfg.profile.avatar;
      img.alt = cfg.profile.displayName || cfg.profile.username;
      img.className = 'avatar-img';
      img.onerror = () => renderAvatarFallback(avatarWrap, cfg);
      avatarWrap.querySelector('.avatar-placeholder')?.replaceWith(img);
    } else {
      renderAvatarFallback(avatarWrap, cfg);
    }
  }

  // Bio
  const bioEl = $('#profile-bio');
  if (bioEl) bioEl.textContent = cfg.profile.bio || '';

  // Typewriter status
  initTypewriter(cfg.profile.statusMessages);

  // Stats
  renderStats(cfg);

  // Socials
  renderSocials(cfg);

  // Discord widget
  renderDiscord(cfg);

  // Spotify
  renderSpotify(cfg);

  // Visitor counter
  renderVisitorCounter(cfg);
}

function renderAvatarFallback(wrap, cfg) {
  const placeholder = wrap.querySelector('.avatar-placeholder') || document.createElement('div');
  placeholder.className = 'avatar-img-placeholder';
  placeholder.textContent = (cfg.profile.displayName || cfg.profile.username || 'Z').charAt(0).toUpperCase();
  if (!wrap.querySelector('.avatar-placeholder')) {
    wrap.querySelector('.avatar-img')?.replaceWith(placeholder);
  }
}

function renderStats(cfg) {
  const s = cfg.stats;
  const sinceEl = $('#stat-since');
  const viewsEl = $('#stat-views');
  const visitsEl = $('#stat-visits');

  if (sinceEl) {
    animateCounter(sinceEl, parseInt(cfg.profile.joinDate) || 2024, 0);
    sinceEl.textContent = cfg.profile.joinDate || '2024';
  }

  if (viewsEl) {
    const views = Math.floor(rand(800, 9999));
    animateCounter(viewsEl, views, 800);
  }

  if (visitsEl && s?.showVisitorCount) {
    const count = getVisitorCount(s.visitorCount || 1);
    animateCounter(visitsEl, count, 1200);
  }
}

/* ── Visitor Counter (localStorage) ── */
function getVisitorCount(base) {
  const key = 'zaza_visitors';
  let count = parseInt(localStorage.getItem(key)) || base;
  const lastVisit = localStorage.getItem('zaza_last_visit');
  const today = new Date().toDateString();
  if (lastVisit !== today) {
    count++;
    localStorage.setItem(key, count);
    localStorage.setItem('zaza_last_visit', today);
  }
  return count;
}

/* ── Animated Counter ── */
function animateCounter(el, target, delay = 0) {
  setTimeout(() => {
    let current = 0;
    const duration = 1200;
    const startTime = performance.now();
    function frame(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      current = Math.floor(ease * target);
      el.textContent = current.toLocaleString();
      if (progress < 1) requestAnimationFrame(frame);
      else el.textContent = target.toLocaleString();
    }
    requestAnimationFrame(frame);
  }, delay);
}

/* ── Social Links Render ── */
function renderSocials(cfg) {
  const container = $('#socials-container');
  if (!container) return;
  container.innerHTML = '';

  const enabled = (cfg.socials || []).filter(s => s.enabled !== false);
  if (!enabled.length) { container.closest('.socials-section')?.classList.add('hidden'); return; }

  enabled.forEach(social => {
    const a = document.createElement('a');
    a.href = social.url || '#';
    a.className = 'social-btn';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.setProperty('--btn-color', social.color || 'var(--accent)');
    a.setAttribute('data-hover', '');
    a.innerHTML = `
      <span class="social-icon"><i class="${social.icon || 'fas fa-link'}"></i></span>
      <span class="social-label">${social.label}</span>
      <span class="social-username">${social.username || ''}</span>
      <span class="social-arrow"><i class="fas fa-arrow-right"></i></span>
    `;
    container.appendChild(a);
  });
}

/* ── Discord Widget ── */
function renderDiscord(cfg) {
  const section = $('#discord-section');
  if (!section) return;
  if (!cfg.discord?.enabled) { section.style.display = 'none'; return; }
  section.style.display = 'flex';
  const usernameEl = section.querySelector('.discord-username');
  if (usernameEl) {
    // Find discord from socials
    const d = cfg.socials?.find(s => s.id === 'discord');
    usernameEl.textContent = d?.username || cfg.discord.userId || 'Discord';
  }
}

/* ── Spotify Section ── */
function renderSpotify(cfg) {
  const section = $('#spotify-section');
  if (!section) return;
  if (!cfg.spotify?.enabled) { section.style.display = 'none'; return; }
  section.style.display = 'flex';
  const trackEl = section.querySelector('.spotify-track');
  if (trackEl) trackEl.textContent = cfg.spotify.fallbackText || 'not listening to anything rn';
}

/* ── Visitor Counter display ── */
function renderVisitorCounter(cfg) {
  const el = $('#visitor-count');
  if (!el || !cfg.stats?.showVisitorCount) return;
  const count = getVisitorCount(cfg.stats.visitorCount || 1);
  animateCounter(el, count, 1600);
}

/* ── Card Tilt Parallax ── */
function initCardTilt() {
  const card = $('.profile-card');
  if (!card) return;
  const maxTilt = 8;

  card.addEventListener('mousemove', e => {
    if (!State.tiltEnabled) return;
    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);
    const rotX = clamp(-dy * maxTilt, -maxTilt, maxTilt);
    const rotY = clamp(dx * maxTilt, -maxTilt, maxTilt);
    card.style.transform = `perspective(1000px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateZ(4px)`;
    card.style.boxShadow = `0 ${16 + dy*8}px ${48 + Math.abs(dy)*16}px rgba(0,0,0,0.6), 0 0 40px rgba(168,85,247,0.15)`;
  });

  card.addEventListener('mouseleave', () => {
    card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) translateZ(0)';
    card.style.boxShadow = '';
    card.style.transition = 'transform 0.6s cubic-bezier(0.23,1,0.32,1), box-shadow 0.6s ease';
    setTimeout(() => card.style.transition = '', 600);
  });

  // Touch: disable tilt on mobile
  if ('ontouchstart' in window) State.tiltEnabled = false;
}

/* ── Music Player ── */
let audioEl = null;

function initMusicPlayer(cfg) {
  if (!cfg.music?.enabled) {
    $('#music-section')?.classList.add('hidden');
    return;
  }

  const tracks = cfg.music.tracks || [];
  if (!tracks.length) return;

  audioEl = new Audio();
  audioEl.volume = cfg.music.defaultVolume ?? 0.5;
  audioEl.preload = 'metadata';
  audioEl.crossOrigin = 'anonymous';

  // Set up audio context + analyser (initialized lazily on first play due to browser policy)
  function ensureAudioContext() {
    if (State.audioCtx) return;
    State.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    State.analyser = State.audioCtx.createAnalyser();
    State.analyser.fftSize = 256;
    State.gainNode = State.audioCtx.createGain();
    State.sourceNode = State.audioCtx.createMediaElementSource(audioEl);
    State.sourceNode.connect(State.analyser);
    State.analyser.connect(State.gainNode);
    State.gainNode.connect(State.audioCtx.destination);
    State.gainNode.gain.value = audioEl.volume;
    startVisualizer();
  }

  function loadTrack(idx) {
    const track = tracks[idx];
    if (!track) return;
    State.currentTrack = idx;

    // Update UI
    const titleEl = $('#music-title');
    const artistEl = $('#music-artist');
    const coverEl  = $('#music-cover');
    if (titleEl)  titleEl.textContent  = track.title  || 'Unknown Track';
    if (artistEl) artistEl.textContent = track.artist || 'Unknown Artist';
    if (coverEl)  {
      if (track.cover) {
        coverEl.style.backgroundImage = `url(${track.cover})`;
        coverEl.style.backgroundSize = 'cover';
        coverEl.innerHTML = '';
      } else {
        coverEl.style.backgroundImage = '';
        coverEl.innerHTML = '<i class="fas fa-music"></i>';
      }
    }

    audioEl.src = track.src;
    audioEl.load();

    // Reset progress
    const fill = $('#music-progress-fill');
    const currTime = $('#music-current');
    if (fill) fill.style.width = '0%';
    if (currTime) currTime.textContent = '0:00';
  }

  function playPause() {
    ensureAudioContext();
    if (State.audioCtx?.state === 'suspended') State.audioCtx.resume();

    if (audioEl.paused) {
      audioEl.play().then(() => {
        State.musicPlaying = true;
        updatePlayBtn(true);
        $('#music-cover')?.classList.add('playing');
      }).catch(err => console.warn('Playback error:', err));
    } else {
      audioEl.pause();
      State.musicPlaying = false;
      updatePlayBtn(false);
      $('#music-cover')?.classList.remove('playing');
    }
  }

  function updatePlayBtn(playing) {
    const btn = $('#play-pause-btn');
    if (!btn) return;
    btn.innerHTML = playing ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
  }

  function prevTrack() {
    const idx = (State.currentTrack - 1 + tracks.length) % tracks.length;
    const wasPlaying = State.musicPlaying;
    loadTrack(idx);
    if (wasPlaying) setTimeout(() => audioEl.play().catch(() => {}), 100);
  }

  function nextTrack() {
    const idx = (State.currentTrack + 1) % tracks.length;
    const wasPlaying = State.musicPlaying;
    loadTrack(idx);
    if (wasPlaying) setTimeout(() => audioEl.play().catch(() => {}), 100);
  }

  // Progress updates
  audioEl.addEventListener('timeupdate', () => {
    if (!audioEl.duration) return;
    const pct = (audioEl.currentTime / audioEl.duration) * 100;
    const fill = $('#music-progress-fill');
    const currTime = $('#music-current');
    const durEl = $('#music-duration');
    if (fill) fill.style.width = pct + '%';
    if (currTime) currTime.textContent = formatTime(audioEl.currentTime);
    if (durEl) durEl.textContent = formatTime(audioEl.duration);
  });

  audioEl.addEventListener('ended', () => {
    if (tracks.length > 1) nextTrack();
    else {
      State.musicPlaying = false;
      updatePlayBtn(false);
      $('#music-cover')?.classList.remove('playing');
    }
  });

  // Volume slider
  const volSlider = $('#volume-slider');
  if (volSlider) {
    volSlider.value = audioEl.volume;
    volSlider.addEventListener('input', e => {
      audioEl.volume = parseFloat(e.target.value);
      if (State.gainNode) State.gainNode.gain.value = audioEl.volume;
      updateVolumeIcon(audioEl.volume);
    });
  }

  // Progress bar click to seek
  const progressBar = $('#music-progress');
  if (progressBar) {
    progressBar.addEventListener('click', e => {
      if (!audioEl.duration) return;
      const rect = progressBar.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      audioEl.currentTime = pct * audioEl.duration;
    });
  }

  // Buttons
  $('#play-pause-btn')?.addEventListener('click', playPause);
  $('#prev-btn')?.addEventListener('click', prevTrack);
  $('#next-btn')?.addEventListener('click', nextTrack);

  // Load first track
  loadTrack(0);

  // Expose playPause for enter screen
  State.playPause = playPause;
}

function updateVolumeIcon(vol) {
  const icon = $('#volume-icon');
  if (!icon) return;
  if (vol === 0) icon.className = 'fas fa-volume-mute volume-icon';
  else if (vol < 0.5) icon.className = 'fas fa-volume-low volume-icon';
  else icon.className = 'fas fa-volume-high volume-icon';
}

function formatTime(secs) {
  if (isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/* ── Audio Visualizer ── */
function startVisualizer() {
  const canvas = $('#visualizer-canvas');
  if (!canvas || !State.analyser) return;
  const ctx2d = canvas.getContext('2d');
  const bufLen = State.analyser.frequencyBinCount;
  const dataArr = new Uint8Array(bufLen);

  function draw() {
    State.animFrames.visualizer = requestAnimationFrame(draw);
    State.analyser.getByteFrequencyData(dataArr);

    const W = canvas.width  = canvas.offsetWidth;
    const H = canvas.height = canvas.offsetHeight || 40;
    ctx2d.clearRect(0, 0, W, H);

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#a855f7';
    const accent2 = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#ec4899';

    const barCount = 48;
    const barWidth = (W / barCount) - 1.5;
    let x = 0;

    for (let i = 0; i < barCount; i++) {
      const dataIdx = Math.floor((i / barCount) * bufLen);
      const val = dataArr[dataIdx];
      const barH = (val / 255) * H;

      // Gradient per bar
      const grad = ctx2d.createLinearGradient(0, H, 0, H - barH);
      grad.addColorStop(0, accent);
      grad.addColorStop(1, accent2);
      ctx2d.fillStyle = grad;
      ctx2d.beginPath();
      ctx2d.roundRect
        ? ctx2d.roundRect(x, H - barH, barWidth, barH, 2)
        : ctx2d.rect(x, H - barH, barWidth, barH);
      ctx2d.fill();
      x += barWidth + 1.5;
    }
  }
  draw();
}

/* ── Weather Effects (Snow / Rain) ── */
function initWeather(cfg) {
  if (!cfg.theme?.snowEnabled && !cfg.theme?.rainEnabled) return;

  const container = document.body;
  const count = 60;
  const type = cfg.theme.snowEnabled ? 'snow' : 'rain';

  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.classList.add('weather-particle', `${type}-particle`);

    if (type === 'snow') {
      el.innerHTML = '❄';
      el.style.cssText = `
        left: ${rand(0,100)}%;
        top: ${rand(-20,0)}%;
        font-size: ${rand(6,14)}px;
        animation-duration: ${rand(6,14)}s;
        animation-delay: ${rand(0,8)}s;
        opacity: ${rand(0.3,0.8)};
      `;
    } else {
      el.style.cssText = `
        left: ${rand(0,100)}%;
        top: ${rand(-100,0)}px;
        width: 1px;
        height: ${rand(12,28)}px;
        animation-duration: ${rand(0.5,1.2)}s;
        animation-delay: ${rand(0,2)}s;
        opacity: ${rand(0.2,0.5)};
      `;
    }
    container.appendChild(el);
  }
}

/* ── Enter Screen ── */
function initEnterScreen() {
  const enterScreen = $('#enter-screen');
  const mainPage = $('#main-page');
  const enterBtn = $('#enter-btn');
  const shortcuts = $('#shortcuts-hint');

  if (!enterScreen || !enterBtn) return;

  function doEnter() {
    if (State.entered) return;
    State.entered = true;

    // Play music if enabled and tracks exist
    if (State.config?.music?.enabled && State.playPause) {
      try { State.playPause(); } catch (e) { /* silently fail */ }
    }

    enterScreen.classList.add('hidden');
    setTimeout(() => {
      mainPage?.classList.add('visible');
      if (shortcuts) shortcuts.style.animationPlayState = 'running';
    }, 300);
  }

  enterBtn.addEventListener('click', doEnter);

  // Keyboard shortcut: Enter key on enter screen
  document.addEventListener('keydown', e => {
    if (!State.entered && (e.code === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      doEnter();
    }
  });
}

/* ── Keyboard Shortcuts ── */
function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (!State.entered) return;

    // Space = play/pause
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      State.playPause?.();
      showToast(State.musicPlaying ? '⏸ Paused' : '▶ Playing');
    }

    // ArrowRight = next track
    if (e.code === 'ArrowRight' && e.altKey) {
      $('#next-btn')?.click();
      showToast('⏭ Next track');
    }

    // ArrowLeft = prev track
    if (e.code === 'ArrowLeft' && e.altKey) {
      $('#prev-btn')?.click();
      showToast('⏮ Previous track');
    }

    // M = mute/unmute
    if (e.code === 'KeyM' && e.target.tagName !== 'INPUT') {
      const vol = $('#volume-slider');
      if (vol) {
        vol.value = vol.value > 0 ? 0 : 0.5;
        vol.dispatchEvent(new Event('input'));
        showToast(vol.value > 0 ? '🔊 Unmuted' : '🔇 Muted');
      }
    }
  });
}

/* ── Toast Notification ── */
function showToast(msg, duration = 2000) {
  let toast = $('#toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

/* ── Theme Switcher (accent color live) ── */
function initThemeFab(cfg) {
  const fab = $('#theme-fab');
  if (!fab) return;

  // Pre-defined accent presets
  const presets = [
    { accent: '#a855f7', accent2: '#ec4899' }, // purple/pink (default)
    { accent: '#3b82f6', accent2: '#06b6d4' }, // blue/cyan
    { accent: '#10b981', accent2: '#34d399' }, // green
    { accent: '#f59e0b', accent2: '#ef4444' }, // amber/red
    { accent: '#f97316', accent2: '#ec4899' }, // orange/pink
  ];
  let presetIdx = 0;

  fab.addEventListener('click', () => {
    presetIdx = (presetIdx + 1) % presets.length;
    const p = presets[presetIdx];
    document.documentElement.style.setProperty('--accent', p.accent);
    document.documentElement.style.setProperty('--accent2', p.accent2);
    document.documentElement.style.setProperty('--accent-glow', hexToRgba(p.accent, 0.35));
    document.documentElement.style.setProperty('--accent2-glow', hexToRgba(p.accent2, 0.25));
    showToast('🎨 Theme changed');
  });
}

function hexToRgba(hex, alpha) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
  const r = parseInt(hex.slice(0,2),16);
  const g = parseInt(hex.slice(2,4),16);
  const b = parseInt(hex.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ── Floating Animation on Card ── */
function initFloatingCard() {
  const card = $('.profile-card');
  if (!card || 'ontouchstart' in window) return;
  let t = 0;
  function floatFrame() {
    t += 0.008;
    const y = Math.sin(t) * 5;
    if (!card.matches(':hover')) {
      card.style.transform = `translateY(${y}px)`;
    }
    requestAnimationFrame(floatFrame);
  }
  // Only float when not tilting
  // We'll skip overlapping with tilt — tilt takes over on hover
}

/* ── Expose config reload (used by admin panel redirect) ── */
window.reloadFromConfig = async function() {
  await loadConfig();
  applyTheme(State.config);
  renderProfile(State.config);
};

/* ── Main Init ── */
async function init() {
  // 1. Start loading screen immediately
  initLoadingScreen();

  // 2. Load config
  await loadConfig();
  const cfg = State.config;

  // 3. Apply theme variables first (so animations use correct colors)
  applyTheme(cfg);

  // 4. Background
  initBackground(cfg);

  // 5. Cursor
  initCursor(cfg);

  // 6. Particles
  initParticles(cfg);

  // 7. Weather
  initWeather(cfg);

  // 8. Enter screen
  initEnterScreen();

  // 9. Music player (no autoplay — triggered by enter)
  initMusicPlayer(cfg);

  // 10. Profile content
  renderProfile(cfg);

  // 11. Card tilt parallax
  initCardTilt();

  // 12. Keyboard shortcuts
  initKeyboardShortcuts();

  // 13. Theme switcher fab
  initThemeFab(cfg);
}

/* ── Boot ── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
