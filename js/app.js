/* ============================================================
   ZAZA — app.js  (luca.wtf layout rebuild)
   Config loader · Cursor · Particles · Profile render
   Music player · Visualizer · Typewriter · Title cycle
   ============================================================ */
'use strict';

/* ── Helpers ── */
const $  = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const rand   = (a, b) => Math.random() * (b - a) + a;
const clamp  = (v, a, b) => Math.min(Math.max(v, a), b);
const lerp   = (a, b, t) => a + (b - a) * t;

/* ── State ── */
const S = {
  cfg: null, entered: false,
  musicPlaying: false, currentTrack: 0,
  audioCtx: null, analyser: null, sourceNode: null, gainNode: null,
  curX: 0, curY: 0, folX: 0, folY: 0,
  playPause: null,
};

/* ══════════════════════════════════════════
   CONFIG — fetch → localStorage → inline → default
══════════════════════════════════════════ */
async function loadConfig() {
  try {
    const r = await fetch('./config.json?v=' + Date.now());
    if (r.ok) { S.cfg = await r.json(); return; }
  } catch (_) {}

  const ls = localStorage.getItem('zaza_config_override');
  if (ls) { try { S.cfg = JSON.parse(ls); return; } catch (_) {} }

  if (window.__ZAZA_CONFIG__) { S.cfg = window.__ZAZA_CONFIG__; return; }

  S.cfg = defaultCfg();
}

function defaultCfg() {
  return {
    profile: { username:'zaza', displayName:'zaza', bio:'just vibing.', avatar:'', status:'online', statusMessages:['just vibing 🎵'], location:'', joinDate:'2024' },
    theme:   { accentColor:'#a855f7', accentColorSecondary:'#ec4899', particleCount:80, snowEnabled:false, rainEnabled:false },
    background: { videoUrl:'', overlayOpacity:0.6 },
    music:   { enabled:true, autoPlay:false, defaultVolume:0.5, tracks:[] },
    socials: [],
    stats:   { showVisitorCount:true, visitorCount:1, showMemberSince:true },
    cursor:  { enabled:true, color:'#a855f7' },
    seo:     { title:'zaza', titleCycle:['zaza — personal','living in the moment.','zaza.'], description:'' },
    admin:   { passwordHash:'6af9676d48eff5f4fea6dd39ffd582ea1d7b5ac0da858923afb16310ecc0d04c', sessionTimeout:3600 },
  };
}

/* ══════════════════════════════════════════
   THEME
══════════════════════════════════════════ */
function applyTheme(c) {
  const r = document.documentElement;
  r.style.setProperty('--accent',  c.theme.accentColor);
  r.style.setProperty('--accent2', c.theme.accentColorSecondary);
  r.style.setProperty('--accent-glow', hexRgba(c.theme.accentColor, 0.35));
  const mt = document.querySelector('meta[name="theme-color"]');
  if (mt) mt.content = c.theme.accentColor;
}

function hexRgba(hex, a) {
  hex = hex.replace('#','');
  if (hex.length===3) hex=hex.split('').map(x=>x+x).join('');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ══════════════════════════════════════════
   LOADING SCREEN
══════════════════════════════════════════ */
function initLoading() {
  const scr = $('#loading-screen'), bar = $('.loader-bar'), txt = $('.loader-text');
  if (!scr) return;
  const steps = ['loading...','setting up...','almost...','done.'];
  let p = 0, si = 0;
  const t = setInterval(() => {
    p += rand(10, 26); if (p > 100) p = 100;
    if (bar) bar.style.width = p + '%';
    const ni = Math.floor((p/100)*steps.length);
    if (txt && ni < steps.length && ni !== si) { si = ni; txt.textContent = steps[si]; }
    if (p >= 100) { clearInterval(t); setTimeout(() => scr.classList.add('hidden'), 350); }
  }, 110);
}

/* ══════════════════════════════════════════
   BACKGROUND
══════════════════════════════════════════ */
function initBackground(c) {
  const ov = $('#bg-overlay');
  if (ov) ov.style.opacity = c.background?.overlayOpacity ?? 0.6;

  const v = $('#bg-video');
  if (v && c.background?.videoUrl) {
    v.src = c.background.videoUrl;
    v.muted = true; // required for autoplay
    v.style.display = 'block';
    v.load();
    v.play().catch(() => {
      // Autoplay blocked — video will start on first user interaction
      document.addEventListener('click', () => v.play().catch(()=>{}), { once: true });
    });
  }
}

/* ══════════════════════════════════════════
   CURSOR
══════════════════════════════════════════ */
function initCursor(c) {
  if (!c.cursor?.enabled) return;
  const cur = $('#cursor'), fol = $('#cursor-follower'), lgt = $('#mouse-light');
  if (!cur) return;

  document.addEventListener('mousemove', e => {
    S.curX = e.clientX; S.curY = e.clientY;
    cur.style.left = e.clientX+'px'; cur.style.top = e.clientY+'px';
    if (lgt) { lgt.style.left = e.clientX+'px'; lgt.style.top = e.clientY+'px'; }
  });

  (function follow() {
    S.folX = lerp(S.folX, S.curX, 0.11);
    S.folY = lerp(S.folY, S.curY, 0.11);
    if (fol) { fol.style.left = S.folX+'px'; fol.style.top = S.folY+'px'; }
    requestAnimationFrame(follow);
  })();

  const sel = 'a,button,[data-hover],.social-row,.enter-btn';
  document.addEventListener('mouseover', e => { if (e.target.closest(sel)) { cur.classList.add('hover'); fol?.classList.add('hover'); } });
  document.addEventListener('mouseout',  e => { if (e.target.closest(sel)) { cur.classList.remove('hover'); fol?.classList.remove('hover'); } });
  document.addEventListener('mousedown', () => cur.classList.add('click'));
  document.addEventListener('mouseup',   () => cur.classList.remove('click'));
}

/* ══════════════════════════════════════════
   PARTICLES
══════════════════════════════════════════ */
function initParticles(c) {
  const cv = $('#particles-canvas'); if (!cv) return;
  const ctx = cv.getContext('2d');
  const n = c.theme?.particleCount || 80;
  const ac = c.theme?.accentColor || '#a855f7';
  const a2 = c.theme?.accentColorSecondary || '#ec4899';

  let W, H, pts = [];
  const resize = () => { W = cv.width = innerWidth; H = cv.height = innerHeight; };

  const hex2rgb = h => { h=h.replace('#',''); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; };
  const [r1,g1,b1] = hex2rgb(ac);
  const [r2,g2,b2] = hex2rgb(a2);

  class P {
    reset(init=false) {
      this.x=rand(0,W); this.y=init?rand(0,H):H+10;
      this.sz=rand(0.4,2); this.vx=rand(-.35,.35); this.vy=rand(-.55,-.1);
      this.op=rand(.08,.4); this.life=1; this.decay=rand(.0006,.0018);
      const t=Math.random()>.65;
      [this.r,this.g,this.b] = t?[r2,g2,b2]:[r1,g1,b1];
    }
    constructor(){this.reset(true);}
    tick(){this.x+=this.vx;this.y+=this.vy;this.life-=this.decay;if(this.life<=0||this.y<-8)this.reset();}
    draw(){ctx.save();ctx.globalAlpha=this.op*this.life;ctx.fillStyle=`rgb(${this.r},${this.g},${this.b})`;ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=3;ctx.beginPath();ctx.arc(this.x,this.y,this.sz,0,Math.PI*2);ctx.fill();ctx.restore();}
  }

  resize(); pts = Array.from({length:n},()=>new P());
  window.addEventListener('resize', resize);

  (function loop(){
    ctx.clearRect(0,0,W,H);
    // connections
    for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++){
      const dx=pts[i].x-pts[j].x,dy=pts[i].y-pts[j].y,d=Math.sqrt(dx*dx+dy*dy);
      if(d<90){ctx.strokeStyle=`rgba(${r1},${g1},${b1},${(1-d/90)*.06})`;ctx.lineWidth=.4;ctx.beginPath();ctx.moveTo(pts[i].x,pts[i].y);ctx.lineTo(pts[j].x,pts[j].y);ctx.stroke();}
    }
    pts.forEach(p=>{p.tick();p.draw();});
    requestAnimationFrame(loop);
  })();
}

/* ══════════════════════════════════════════
   PROFILE RENDER
══════════════════════════════════════════ */
function renderProfile(c) {
  const p = c.profile;

  // Username
  const un = $('#profile-username'); if (un) un.textContent = p.displayName || p.username;

  // Avatar
  const wrap = $('#avatar-wrap');
  if (wrap && p.avatar) {
    const img = document.createElement('img');
    img.src = p.avatar; img.alt = p.displayName; img.className = 'avatar-img';
    img.onerror = () => { img.replaceWith(makeInitial(p)); };
    const old = wrap.querySelector('.avatar-initial,img.avatar-img');
    old ? old.replaceWith(img) : wrap.appendChild(img);
  }

  // Bio
  const bio = $('#profile-bio'); if (bio) bio.textContent = p.bio || '';

  // Badges (tech stack icons from config.badges or a default set)
  renderBadges(c);

  // Stats
  renderStats(c);

  // Socials
  renderSocials(c);

  // Status typewriter
  initTypewriter(p.statusMessages || ['just vibing 🎵']);

  // Page title cycle
  initTitleTypewriter(c.seo?.titleCycle || [c.seo?.title || 'zaza']);
}

function makeInitial(p) {
  const d = document.createElement('div');
  d.className = 'avatar-initial';
  d.textContent = (p.displayName||p.username||'Z').charAt(0).toUpperCase();
  return d;
}

function renderBadges(c) {
  const row = $('#badges-row'); if (!row) return;
  // Default tech badges if not in config
  const badges = c.badges || [
    {icon:'fab fa-js-square',   color:'#F7DF1E', label:'JavaScript'},
    {icon:'fab fa-python',      color:'#3776AB', label:'Python'},
    {icon:'fab fa-discord',     color:'#5865F2', label:'Discord'},
    {icon:'fab fa-github',      color:'#fff',    label:'GitHub'},
    {icon:'fab fa-html5',       color:'#E34F26', label:'HTML5'},
    {icon:'fab fa-css3-alt',    color:'#1572B6', label:'CSS3'},
  ];
  row.innerHTML = '';
  badges.forEach(b => {
    const el = document.createElement('span');
    el.className = 'badge'; el.title = b.label;
    el.innerHTML = `<i class="${b.icon}" style="color:${b.color}"></i>`;
    row.appendChild(el);
  });
}

function renderStats(c) {
  const sinceEl = $('#stat-since'), viewsEl = $('#stat-views'), visitsEl = $('#stat-visits');
  if (sinceEl) sinceEl.textContent = c.profile?.joinDate || '2024';
  if (viewsEl)  counter(viewsEl, Math.floor(rand(800,9999)), 700);
  if (visitsEl && c.stats?.showVisitorCount) counter(visitsEl, getVisits(c.stats.visitorCount||1), 1000);
}

function getVisits(base) {
  const k='zaza_visitors', lk='zaza_last_visit';
  let n = parseInt(localStorage.getItem(k)) || base;
  if (localStorage.getItem(lk) !== new Date().toDateString()) {
    n++; localStorage.setItem(k, n); localStorage.setItem(lk, new Date().toDateString());
  }
  return n;
}

function counter(el, target, delay=0) {
  setTimeout(() => {
    const start = performance.now(), dur = 1000;
    const tick = now => {
      const p = Math.min((now-start)/dur, 1);
      el.textContent = Math.floor((1-Math.pow(1-p,3))*target).toLocaleString();
      if (p < 1) requestAnimationFrame(tick); else el.textContent = target.toLocaleString();
    };
    requestAnimationFrame(tick);
  }, delay);
}

function renderSocials(c) {
  const con = $('#socials-container'); if (!con) return;
  con.innerHTML = '';
  (c.socials||[]).filter(s=>s.enabled!==false).forEach(s => {
    const a = document.createElement('a');
    a.className = 'social-row'; a.href = s.url||'#'; a.target='_blank'; a.rel='noopener noreferrer';
    a.style.setProperty('--btn-color', s.color||'var(--accent)');
    a.innerHTML = `
      <div class="social-row-left">
        <i class="${s.icon||'fas fa-link'} social-row-icon"></i>
        <span class="social-row-label">${s.label}</span>
      </div>
      <span class="social-row-value">${s.username||''}</span>
    `;
    con.appendChild(a);
  });
}

/* ══════════════════════════════════════════
   TYPEWRITER — status text
══════════════════════════════════════════ */
function initTypewriter(msgs) {
  const el = $('#status-typewriter'); if (!el || !msgs.length) return;
  let mi=0, ci=0, del=false, paused=false;

  function type() {
    if (paused) return;
    const m = msgs[mi];
    if (!del) {
      ci++; el.textContent = m.slice(0,ci);
      if (ci===m.length) { paused=true; setTimeout(()=>{del=true;paused=false;tick();},2200); return; }
    } else {
      ci--; el.textContent = m.slice(0,ci);
      if (ci===0) { del=false; mi=(mi+1)%msgs.length; }
    }
    tick();
  }
  function tick() { setTimeout(type, del ? 38 : rand(55,95)); }
  tick();
}

/* ══════════════════════════════════════════
   PAGE TITLE TYPEWRITER — cycles through titleCycle array
══════════════════════════════════════════ */
function initTitleTypewriter(titles) {
  if (!titles || titles.length===0) return;
  let ti=0, ci=0, del=false, paused=false;

  function type() {
    if (paused) return;
    const t = titles[ti];
    if (!del) {
      ci++; document.title = t.slice(0,ci);
      if (ci===t.length) { paused=true; setTimeout(()=>{del=true;paused=false;tick();},2800); return; }
    } else {
      ci--; document.title = t.slice(0,ci) + '|';
      if (ci===0) { del=false; ti=(ti+1)%titles.length; }
    }
    tick();
  }
  function tick() { setTimeout(type, del ? 35 : rand(60,100)); }
  // Start after a small delay so the page loads first
  setTimeout(tick, 2500);
}

/* ══════════════════════════════════════════
   MUSIC PLAYER
══════════════════════════════════════════ */
let audioEl = null;

function initMusic(c) {
  const bar = $('#music-bar');
  if (!c.music?.enabled || !c.music.tracks?.length) { if (bar) bar.style.display='none'; return; }
  if (bar) bar.style.display='flex';

  audioEl = new Audio();
  audioEl.volume = c.music.defaultVolume ?? 0.5;
  // Only set crossOrigin if not a local file:// path — avoids CORS rejection
  // on GitHub Pages for same-origin assets we still need it for Web Audio API
  audioEl.crossOrigin = 'anonymous';
  audioEl.preload = 'metadata';
  audioEl.loop = false;

  function ensureCtx() {
    if (S.audioCtx) { if (S.audioCtx.state==='suspended') S.audioCtx.resume(); return; }
    try {
      S.audioCtx = new (window.AudioContext||window.webkitAudioContext)();
      S.analyser = S.audioCtx.createAnalyser(); S.analyser.fftSize=256;
      S.gainNode = S.audioCtx.createGain(); S.gainNode.gain.value = audioEl.volume;
      S.sourceNode = S.audioCtx.createMediaElementSource(audioEl);
      S.sourceNode.connect(S.analyser); S.analyser.connect(S.gainNode); S.gainNode.connect(S.audioCtx.destination);
      startViz();
    } catch(err) {
      console.warn('Web Audio API setup failed (CORS or browser restriction):', err);
      // Audio still plays, just no visualizer
    }
  }

  function loadTrack(idx) {
    const t = c.music.tracks[idx]; if (!t) return;
    S.currentTrack = idx;
    const titleEl  = $('#music-title-mini');
    const artistEl = $('#music-artist-mini');
    const coverEl  = $('#music-cover-mini');
    if (titleEl)  titleEl.textContent  = t.title  || 'Unknown';
    if (artistEl) artistEl.textContent = t.artist || '—';
    if (coverEl) {
      if (t.cover) { coverEl.style.cssText='background-image:url('+t.cover+');background-size:cover;'; coverEl.innerHTML=''; }
      else { coverEl.style.cssText='background:linear-gradient(135deg,var(--accent),var(--accent2));'; coverEl.innerHTML='<i class="fas fa-music"></i>'; }
    }
    audioEl.src = t.src; audioEl.load();
    const f = $('#music-progress-fill-mini'); if (f) f.style.width='0%';
    const tm = $('#music-time-mini'); if (tm) tm.textContent='0:00';
  }

  function playPause() {
    ensureCtx();
    if (audioEl.paused) {
      audioEl.play().then(() => {
        S.musicPlaying = true;
        updatePlayBtn(true);
        $('#music-cover-mini')?.classList.add('playing');
      }).catch(err => { console.warn('Playback blocked:', err); });
    } else {
      audioEl.pause();
      S.musicPlaying = false;
      updatePlayBtn(false);
      $('#music-cover-mini')?.classList.remove('playing');
    }
  }

  function updatePlayBtn(playing) {
    const btn = $('#play-pause-btn'); if (!btn) return;
    btn.innerHTML = playing ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
  }

  audioEl.addEventListener('timeupdate', () => {
    if (!audioEl.duration) return;
    const pct = (audioEl.currentTime/audioEl.duration)*100;
    const f = $('#music-progress-fill-mini'); if (f) f.style.width=pct+'%';
    const tm = $('#music-time-mini'); if (tm) tm.textContent=fmtTime(audioEl.currentTime);
  });

  audioEl.addEventListener('ended', () => {
    if (c.music.tracks.length>1) { loadTrack((S.currentTrack+1)%c.music.tracks.length); audioEl.play().catch(()=>{}); }
    else { S.musicPlaying=false; updatePlayBtn(false); $('#music-cover-mini')?.classList.remove('playing'); }
  });

  const vol = $('#volume-slider');
  if (vol) {
    vol.value = audioEl.volume;
    vol.addEventListener('input', e => {
      audioEl.volume = parseFloat(e.target.value);
      if (S.gainNode) S.gainNode.gain.value = audioEl.volume;
    });
  }

  const prog = $('#music-progress-mini');
  if (prog) prog.addEventListener('click', e => {
    if (!audioEl.duration) return;
    audioEl.currentTime = (e.offsetX/prog.offsetWidth)*audioEl.duration;
  });

  $('#play-pause-btn')?.addEventListener('click', playPause);
  $('#prev-btn')?.addEventListener('click', () => { loadTrack((S.currentTrack-1+c.music.tracks.length)%c.music.tracks.length); if(S.musicPlaying) audioEl.play().catch(()=>{}); });
  $('#next-btn')?.addEventListener('click', () => { loadTrack((S.currentTrack+1)%c.music.tracks.length); if(S.musicPlaying) audioEl.play().catch(()=>{}); });

  loadTrack(0);
  S.playPause = playPause;
}

function fmtTime(s) {
  if (isNaN(s)) return '0:00';
  return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
}

/* ── Audio Visualizer ── */
function startViz() {
  const cv = $('#visualizer-canvas'); if (!cv||!S.analyser) return;
  const ctx = cv.getContext('2d');
  const buf = new Uint8Array(S.analyser.frequencyBinCount);
  (function draw() {
    requestAnimationFrame(draw);
    S.analyser.getByteFrequencyData(buf);
    const W=cv.width=cv.offsetWidth||80, H=cv.height=cv.offsetHeight||24;
    ctx.clearRect(0,0,W,H);
    const bars=24, bw=(W/bars)-1;
    const ac=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#a855f7';
    const a2=getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim()||'#ec4899';
    let x=0;
    for(let i=0;i<bars;i++){
      const v=buf[Math.floor(i/bars*buf.length)];
      const bh=Math.max(2,(v/255)*H);
      const g=ctx.createLinearGradient(0,H,0,H-bh);
      g.addColorStop(0,ac); g.addColorStop(1,a2);
      ctx.fillStyle=g;
      ctx.beginPath();
      if(ctx.roundRect) ctx.roundRect(x,H-bh,bw,bh,1); else ctx.rect(x,H-bh,bw,bh);
      ctx.fill();
      x+=bw+1;
    }
  })();
}

/* ══════════════════════════════════════════
   ENTER SCREEN
══════════════════════════════════════════ */
function initEnter() {
  const es=$('#enter-screen'), mp=$('#main-page'), btn=$('#enter-btn');
  if (!es||!btn) return;

  function doEnter() {
    if (S.entered) return; S.entered=true;
    if (S.cfg?.music?.enabled && S.playPause) { try { S.playPause(); } catch(_){} }
    es.classList.add('hidden');
    setTimeout(() => mp?.classList.add('visible'), 200);
  }

  btn.addEventListener('click', doEnter);
  document.addEventListener('keydown', e => {
    if (!S.entered && (e.code==='Enter'||e.code==='Space')) { e.preventDefault(); doEnter(); }
  });
}

/* ══════════════════════════════════════════
   KEYBOARD SHORTCUTS
══════════════════════════════════════════ */
function initKeys() {
  document.addEventListener('keydown', e => {
    if (!S.entered) return;
    if (e.code==='Space' && e.target.tagName!=='INPUT') {
      e.preventDefault();
      S.playPause?.();
      // Read state AFTER toggle (playPause flips S.musicPlaying)
      setTimeout(() => toast(S.musicPlaying ? '▶ Playing' : '⏸ Paused'), 20);
    }
    if (e.code==='ArrowRight'&&e.altKey) { $('#next-btn')?.click(); toast('⏭ Next'); }
    if (e.code==='ArrowLeft'&&e.altKey)  { $('#prev-btn')?.click(); toast('⏮ Prev'); }
    if (e.code==='KeyM'&&e.target.tagName!=='INPUT') {
      const v=$('#volume-slider'); if(v){v.value=v.value>0?0:0.5;v.dispatchEvent(new Event('input'));toast(v.value>0?'🔊 Unmuted':'🔇 Muted');}
    }
  });
}

/* ── Toast ── */
function toast(msg, dur=1800) {
  let t=$('#_toast');
  if(!t){t=document.createElement('div');t.id='_toast';t.className='toast';document.body.appendChild(t);}
  t.textContent=msg; t.classList.add('show');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),dur);
}

/* ══════════════════════════════════════════
   THEME FAB
══════════════════════════════════════════ */
function initThemeFab() {
  const fab=$('#theme-fab'); if(!fab) return;
  const presets=[
    {a:'#a855f7',b:'#ec4899'},{a:'#3b82f6',b:'#06b6d4'},
    {a:'#10b981',b:'#34d399'},{a:'#f59e0b',b:'#ef4444'},
    {a:'#f97316',b:'#ec4899'},
  ];
  let idx=0;
  fab.addEventListener('click',()=>{
    idx=(idx+1)%presets.length;
    const {a,b}=presets[idx];
    document.documentElement.style.setProperty('--accent',a);
    document.documentElement.style.setProperty('--accent2',b);
    document.documentElement.style.setProperty('--accent-glow',hexRgba(a,.35));
    toast('🎨 Theme changed');
  });
}

/* ══════════════════════════════════════════
   WEATHER (snow/rain)
══════════════════════════════════════════ */
function initWeather(c) {
  if (!c.theme?.snowEnabled && !c.theme?.rainEnabled) return;
  const type = c.theme.snowEnabled ? 'snow' : 'rain';
  for (let i=0;i<55;i++) {
    const el=document.createElement('div');
    el.style.cssText=`position:fixed;pointer-events:none;z-index:5;animation:weatherFall linear infinite;left:${rand(0,100)}%;top:${rand(-20,0)}%;animation-duration:${rand(6,14)}s;animation-delay:${rand(0,8)}s;opacity:${rand(0.2,0.7)};`;
    if(type==='snow'){el.textContent='❄';el.style.fontSize=rand(5,12)+'px';el.style.color='rgba(255,255,255,.7)';}
    else{el.style.width='1px';el.style.height=rand(10,24)+'px';el.style.background='linear-gradient(to bottom,transparent,rgba(180,220,255,.4))';}
    document.body.appendChild(el);
  }
  // inject keyframe if not already present
  if(!document.querySelector('#weather-style')){
    const s=document.createElement('style');s.id='weather-style';
    s.textContent='@keyframes weatherFall{from{transform:translateY(-20px);opacity:1}to{transform:translateY(110vh);opacity:.1}}';
    document.head.appendChild(s);
  }
}

/* ══════════════════════════════════════════
   MAIN INIT
══════════════════════════════════════════ */
async function init() {
  initLoading();
  await loadConfig();
  const c = S.cfg;

  applyTheme(c);
  initBackground(c);
  initCursor(c);
  initParticles(c);
  initWeather(c);
  initEnter();
  initMusic(c);
  renderProfile(c);
  initKeys();
  initThemeFab();
}

document.readyState==='loading' ? document.addEventListener('DOMContentLoaded',init) : init();
