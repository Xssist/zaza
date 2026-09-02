"use strict";
/* ============================================================
   ZADE — presence.ts
   Discord presence + Spotify now-playing, powered by Lanyard.
   No Discord user tokens, no selfbots, no OAuth, no auth.
   Compiles to js/presence.js (minified: js/presence.min.js).
   ============================================================ */
/* ── Small utils ───────────────────────────────────────────── */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function fmtTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
        : `${m}:${String(sec).padStart(2, '0')}`;
}
const STATUS_LABEL = {
    online: 'online',
    idle: 'away',
    dnd: 'do not disturb',
    offline: 'offline',
};
const ACTIVITY_LABEL = {
    0: 'Playing',
    1: 'Streaming',
    2: 'Listening to',
    3: 'Watching',
    5: 'Competing in',
};
const ACTIVITY_ICON = {
    0: 'fas fa-gamepad',
    1: 'fas fa-tv',
    2: 'fas fa-music',
    3: 'fas fa-eye',
    5: 'fas fa-trophy',
};
/** Lanyard CDN asset → URL (handles external/Spotify media). */
function lanyardAsset(appId, assetId) {
    if (!assetId)
        return '';
    if (assetId.startsWith('mp:external/')) {
        return `https://media.discordapp.net/external/${assetId.replace('mp:external/', '')}`;
    }
    if (assetId.startsWith('spotify:'))
        return '';
    return `https://cdn.discordapp.com/app-assets/${appId ?? '0'}/${assetId}.png`;
}
/** Reduced-motion respect (matches site behaviour). */
function prefersReduced() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
/** Stable signature so we skip DOM writes when nothing changed. */
function signature(p) {
    const a = p.activities.filter(x => x.type !== 4).map(x => `${x.id}:${x.name}:${x.details ?? ''}:${x.state ?? ''}:${x.timestamps?.start ?? ''}`);
    const sp = p.spotify ? `${p.spotify.track_id}:${p.spotify.timestamps.start}` : 'none';
    return `${p.discord_status}|${p.discord_user.username}|${a.join(';')}|${sp}`;
}
class LanyardClient {
    constructor(userId) {
        this.ws = null;
        this.reconnectDelay = 1000;
        this.wsFailures = 0;
        this.dead = false;
        this.listeners = new Set();
        this.lastPresence = null;
        this.lastSig = '';
        this.CACHE_KEY = 'zade_presence_cache';
        this.userId = userId;
        this.restoreCache();
    }
    subscribe(fn) {
        this.listeners.add(fn);
        if (this.lastPresence)
            fn(this.lastPresence);
        return () => { this.listeners.delete(fn); };
    }
    emit(p) {
        this.lastPresence = p;
        this.lastSig = signature(p);
        try {
            sessionStorage.setItem(this.cacheKey(), JSON.stringify({ t: Date.now(), p }));
        }
        catch { /* quota */ }
        this.listeners.forEach(fn => { try {
            fn(p);
        }
        catch { /* keep others alive */ } });
    }
    cacheKey() { return `${this.CACHE_KEY}:${this.userId}`; }
    /** Warm-start: restore a <60s old cached presence so UI is never empty. */
    restoreCache() {
        try {
            const raw = sessionStorage.getItem(this.cacheKey());
            if (!raw)
                return;
            const { t, p } = JSON.parse(raw);
            if (Date.now() - t < 60000 && p?.discord_user)
                this.emit(p);
        }
        catch { /* invalid cache — ignore */ }
    }
    start() {
        this.connect();
        document.addEventListener('visibilitychange', () => {
            if (document.hidden)
                this.pause();
            else
                this.resume();
        });
    }
    destroy() {
        this.dead = true;
        this.pause();
        this.ws?.close();
        this.ws = null;
        this.listeners.clear();
    }
    pause() {
        if (this.heartbeat) {
            clearInterval(this.heartbeat);
            this.heartbeat = undefined;
        }
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }
    resume() {
        if (this.dead)
            return;
        if (this.ws && this.ws.readyState === WebSocket.OPEN)
            return; // socket still alive
        if (this.wsFailures >= 3)
            this.startPolling();
        else
            this.connect();
    }
    connect() {
        if (this.dead || this.ws)
            return;
        try {
            this.ws = new WebSocket('wss://api.lanyard.rest/socket');
        }
        catch {
            this.ws = null;
            this.scheduleReconnect();
            return;
        }
        this.ws.addEventListener('open', () => {
            this.wsFailures = 0;
            this.reconnectDelay = 1000;
            this.stopPolling(); // realtime socket wins over polling
        });
        this.ws.addEventListener('message', ev => {
            let msg;
            try {
                msg = JSON.parse(ev.data);
            }
            catch {
                return;
            }
            if (msg.op === 1) { // Hello
                const interval = msg.d?.heartbeat_interval ?? 30000;
                if (this.heartbeat)
                    clearInterval(this.heartbeat);
                this.heartbeat = window.setInterval(() => {
                    if (this.ws?.readyState === WebSocket.OPEN) {
                        this.ws.send(JSON.stringify({ op: 3 }));
                    }
                }, interval);
                this.ws?.send(JSON.stringify({ op: 2, d: { subscribe_to_id: this.userId } }));
            }
            else if (msg.op === 0 && (msg.t === 'INIT_STATE' || msg.t === 'PRESENCE_UPDATE')) {
                // INIT_STATE may be keyed by user id or delivered directly (varies by
                // Lanyard version) — accept both shapes. PRESENCE_UPDATE is direct.
                const d = msg.d;
                const presence = (d?.[this.userId]?.discord_user ? d[this.userId]
                    : d?.discord_user ? d : undefined);
                if (presence?.discord_user)
                    this.emit(presence);
            }
        });
        this.ws.addEventListener('close', () => {
            this.ws = null;
            if (this.heartbeat) {
                clearInterval(this.heartbeat);
                this.heartbeat = undefined;
            }
            this.wsFailures++;
            if (this.wsFailures >= 3) {
                this.startPolling(); // graceful degradation
                this.scheduleReconnect(); // still try to recover realtime
            }
            else {
                this.scheduleReconnect();
            }
        });
        this.ws.addEventListener('error', () => {
            try {
                this.ws?.close();
            }
            catch { /* already closed */ }
        });
    }
    scheduleReconnect() {
        if (this.dead || this.reconnectHandle)
            return;
        this.reconnectHandle = window.setTimeout(() => {
            this.reconnectHandle = undefined;
            this.connect();
        }, Math.min(this.reconnectDelay, 30000));
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    }
    /* ── REST fallback (Lanyard v1) — only after WS proved unreliable ── */
    startPolling() {
        if (this.pollTimer)
            return;
        const poll = async () => {
            if (document.hidden)
                return;
            try {
                const r = await fetch(`https://api.lanyard.rest/v1/users/${this.userId}`, { headers: { Accept: 'application/json' } });
                if (!r.ok)
                    return;
                const body = await r.json();
                const p = body?.data;
                if (p?.discord_user)
                    this.emit(p);
            }
            catch { /* network hiccup — next tick retries */ }
        };
        poll();
        this.pollTimer = window.setInterval(poll, 30000);
    }
    /** One-shot REST fetch — instant paint while the WS handshake completes. */
    fetchOnce() {
        void (async () => {
            try {
                const r = await fetch(`https://api.lanyard.rest/v1/users/${this.userId}`, { headers: { Accept: 'application/json' } });
                if (!r.ok)
                    return;
                const body = await r.json();
                const p = body?.data;
                if (p?.discord_user)
                    this.emit(p);
            }
            catch { /* WS will deliver the data anyway */ }
        })();
    }
    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }
}
/* ════════════════════════════════════════════════════════════
   DiscordCard — avatar, username, animated status, activity.
   Renders skeleton → content; no layout shift (fixed heights).
   ════════════════════════════════════════════════════════════ */
class DiscordCard {
    constructor(rootId) {
        this.sig = '';
        this.elapsedStart = 0;
        this.elapsedEl = null;
        const el = document.getElementById(rootId);
        if (!el)
            throw new Error(`#${rootId} missing`);
        this.root = el;
        this.renderSkeleton();
    }
    renderSkeleton() {
        this.root.innerHTML = `
      <div class="pc-skel pc-skel-avatar"></div>
      <div class="pc-skel-body">
        <div class="pc-skel pc-skel-line w60"></div>
        <div class="pc-skel pc-skel-line w40"></div>
        <div class="pc-skel pc-skel-line w75"></div>
      </div>`;
    }
    contentEl(cls) {
        return `
      <div class="pc-head">
        <div class="pc-avatar-wrap">
          <img class="pc-avatar" alt="Discord avatar" draggable="false" />
          <span class="pc-status-dot" aria-hidden="true"></span>
        </div>
        <div class="pc-id">
          <div class="pc-name"></div>
          <div class="pc-status"></div>
        </div>
        <i class="fab fa-discord pc-brand" aria-hidden="true"></i>
      </div>
      <div class="pc-activity ${cls}">
        <div class="pc-act-img-wrap">
          <img class="pc-act-img" alt="" draggable="false" />
          <div class="pc-act-ph"><i class="fas fa-gamepad" aria-hidden="true"></i></div>
          <img class="pc-act-small" alt="" draggable="false" />
        </div>
        <div class="pc-act-body">
          <div class="pc-act-type"></div>
          <div class="pc-act-name"></div>
          <div class="pc-act-detail"></div>
          <div class="pc-act-state"></div>
          <div class="pc-act-elapsed"></div>
        </div>
      </div>
      <div class="pc-error" hidden>presence unavailable</div>`;
    }
    render(p, cfg) {
        const sig = signature(p);
        if (sig === this.sig)
            return; // skip identical renders
        const first = this.sig === '';
        this.sig = sig;
        if (this.root.querySelector('.pc-skel')) {
            this.root.classList.add('ready');
            this.root.innerHTML = this.contentEl(cfg.showActivity === false ? 'hidden' : '');
        }
        const q = (s) => this.root.querySelector(s);
        const user = p.discord_user;
        // Avatar (fade-swap on change)
        const av = q('.pc-avatar');
        if (av && user.avatar) {
            const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
            const url = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
            if (av.src !== url) {
                av.style.opacity = '0';
                av.onload = () => { av.style.opacity = '1'; };
                av.onerror = () => { av.style.opacity = '0'; };
                av.src = url;
            }
        }
        // Status
        const status = p.discord_status;
        const dot = q('.pc-status-dot');
        if (dot)
            dot.dataset.status = status;
        const statusEl = q('.pc-status');
        // Custom status (type 4) lives beside the label — it was previously
        // written into the (usually hidden) activity detail, so it never showed.
        const custom = p.activities.find(a => a.type === 4);
        const customText = custom ? `${custom.emoji?.name ?? ''}${custom.state ?? ''}`.trim() : '';
        if (statusEl)
            statusEl.textContent = customText ? `${STATUS_LABEL[status] ?? status} · ${customText}` : (STATUS_LABEL[status] ?? status);
        const nameEl = q('.pc-name');
        if (nameEl)
            nameEl.textContent = user.global_name || user.display_name || user.username || 'discord';
        // Activity — most interesting non-custom, non-Spotify activity
        const acts = p.activities.filter(a => a.type !== 4 && a.id !== 'spotify:1');
        const actWrap = q('.pc-activity');
        const act = acts[0];
        this.stopElapsed();
        if (cfg.showActivity !== false && act && actWrap) {
            const typeEl = q('.pc-act-type');
            const nameA = q('.pc-act-name');
            const stateEl = q('.pc-act-state');
            if (typeEl)
                typeEl.textContent = ACTIVITY_LABEL[act.type] ?? 'Playing';
            if (nameA)
                nameA.textContent = act.name || '';
            if (stateEl)
                stateEl.textContent = [act.details, act.state].filter(Boolean).join(' — ');
            const img = q('.pc-act-img');
            const ph = q('.pc-act-ph');
            const small = this.root.querySelector('.pc-act-small');
            const largeUrl = act.assets?.large_image ? lanyardAsset(act.application_id, act.assets.large_image) : '';
            const smallUrl = act.assets?.small_image ? lanyardAsset(act.application_id, act.assets.small_image) : '';
            if (img) {
                if (largeUrl) {
                    if (img.src !== largeUrl) {
                        img.src = largeUrl;
                    }
                    img.dataset.on = '1';
                }
                else
                    img.dataset.on = '';
            }
            if (ph)
                ph.classList.toggle('show', !largeUrl);
            if (ph) {
                const icon = ph.querySelector('i');
                if (icon)
                    icon.className = `${ACTIVITY_ICON[act.type] ?? 'fas fa-gamepad'}`;
            }
            if (small) {
                if (smallUrl) {
                    if (small)
                        small.src = smallUrl;
                    small.dataset.on = '1';
                }
                else
                    small.dataset.on = '';
            }
            if (act.timestamps?.start)
                this.startElapsed(act.timestamps.start, q('.pc-act-elapsed'));
            actWrap.classList.remove('hidden');
        }
        else if (actWrap) {
            actWrap.classList.add('hidden');
        }
        // Always clear stale activity text so nothing lingers between tracks/games
        if (!act || cfg.showActivity === false) {
            const t = q('.pc-act-type');
            const n = q('.pc-act-name');
            const st = q('.pc-act-state');
            const de = q('.pc-act-detail');
            if (t)
                t.textContent = '';
            if (n)
                n.textContent = '';
            if (st)
                st.textContent = '';
            if (de)
                de.textContent = '';
            const el2 = q('.pc-act-elapsed');
            if (el2)
                el2.textContent = '';
            const im = q('.pc-act-img');
            if (im)
                im.removeAttribute('src');
        }
        if (first)
            this.root.classList.add('pop');
    }
    showError() {
        if (this.root.querySelector('.pc-skel')) {
            this.root.classList.add('ready');
            this.root.innerHTML = this.contentEl('hidden');
        }
        const err = this.root.querySelector('.pc-error');
        if (err)
            err.hidden = false;
        this.root.classList.add('degraded');
    }
    startElapsed(startMs, el) {
        this.elapsedStart = startMs;
        this.elapsedEl = el;
        if (!el)
            return;
        const tick = () => {
            if (this.elapsedEl)
                this.elapsedEl.textContent = `elapsed ${fmtTime(Date.now() - this.elapsedStart)}`;
        };
        tick();
        this.elapsedTimer = window.setInterval(tick, 1000);
    }
    stopElapsed() {
        if (this.elapsedTimer) {
            clearInterval(this.elapsedTimer);
            this.elapsedTimer = undefined;
        }
        if (this.elapsedEl)
            this.elapsedEl.textContent = '';
    }
}
/* ════════════════════════════════════════════════════════════
   SpotifyCard — now playing from Lanyard activity data.
   rAF-driven progress (only while playing & visible), elastic
   artwork animation, elegant fallback — never leaves a gap.
   ════════════════════════════════════════════════════════════ */
class SpotifyCard {
    constructor(rootId, fallbackText) {
        this.trackId = '';
        this.isPlaying = false;
        this.start = 0;
        this.end = 0;
        this.rafId = 0;
        this.lastPct = -1;
        const el = document.getElementById(rootId);
        if (!el)
            throw new Error(`#${rootId} missing`);
        this.root = el;
        this.fallbackText = fallbackText || 'not listening to anything';
        this.renderSkeleton();
    }
    renderSkeleton() {
        this.root.innerHTML = `
      <div class="pc-skel pc-skel-art"></div>
      <div class="pc-skel-body">
        <div class="pc-skel pc-skel-line w75"></div>
        <div class="pc-skel pc-skel-line w50"></div>
        <div class="pc-skel pc-skel-line w90"></div>
      </div>`;
    }
    contentEl() {
        return `
      <div class="sp-art-wrap">
        <img class="sp-art" alt="Album cover" draggable="false" />
        <div class="sp-art-ph"><i class="fab fa-spotify" aria-hidden="true"></i></div>
      </div>
      <div class="sp-body">
        <div class="sp-top">
          <div class="sp-kicker"><i class="fab fa-spotify" aria-hidden="true"></i><span>spotify</span></div>
          <div class="sp-state"><i class="fas fa-circle sp-state-dot" aria-hidden="true"></i><span class="sp-state-text"></span></div>
        </div>
        <div class="sp-title"></div>
        <div class="sp-artist"></div>
        <div class="sp-progress">
          <div class="sp-progress-fill"><span class="sp-progress-knob"></span></div>
        </div>
        <div class="sp-times"><span class="sp-t-cur">0:00</span><span class="sp-t-end">0:00</span></div>
      </div>
      <div class="sp-fallback">
        <i class="fab fa-spotify" aria-hidden="true"></i>
        <span>${this.escape(this.fallbackText)}</span>
      </div>`;
    }
    escape(s) {
        return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    render(p) {
        const sp = p.spotify;
        const q = (s) => this.root.querySelector(s);
        // Transition skeleton → content once
        if (this.root.querySelector('.pc-skel')) {
            this.root.classList.add('ready');
            this.root.innerHTML = this.contentEl();
        }
        if (!sp?.timestamps) {
            this.showFallback();
            return;
        }
        this.root.classList.remove('fallback');
        // Same track → only update play state / progress anchors
        const sameTrack = sp.track_id === this.trackId;
        this.trackId = sp.track_id;
        this.start = sp.timestamps.start ?? Date.now();
        this.end = sp.timestamps.end ?? this.start;
        this.setPlaying(true);
        const stateText = q('.sp-state-text');
        if (stateText)
            stateText.textContent = 'playing';
        if (!sameTrack) {
            const title = q('.sp-title');
            const artist = q('.sp-artist');
            const art = q('.sp-art');
            if (title)
                title.textContent = sp.song || 'Unknown';
            if (artist)
                artist.textContent = sp.artist || '—';
            if (art) {
                art.style.opacity = '0';
                art.onload = () => { art.style.opacity = '1'; this.root.classList.add('pop'); };
                art.onerror = () => { art.style.opacity = '0'; };
                art.src = sp.album_art_url || '';
            }
            this.root.title = `${sp.song} — ${sp.artist}`;
        }
    }
    /** Public: flip the card to its idle/fallback state. */
    showFallback() {
        if (this.root.classList.contains('fallback'))
            return;
        this.trackId = '';
        this.stopProgress();
        this.root.classList.add('fallback');
        const stateText = this.root.querySelector('.sp-state-text');
        if (stateText)
            stateText.textContent = 'idle';
        // Keep album art visible if we have one; hide body if it doesn't exist yet
        const art = this.root.querySelector('.sp-art');
        const artWrap = this.root.querySelector('.sp-art-wrap');
        const hasArt = !!art?.src && art.dataset.on !== undefined && art.complete && art.naturalWidth > 0;
        if (artWrap)
            artWrap.classList.toggle('hidden', !hasArt);
        const fb = this.root.querySelector('.sp-fallback');
        if (fb)
            fb.textContent = this.fallbackText;
        this.root.classList.add('pop');
    }
    /** Playing/paused toggling (Lanyard only reports playing tracks). */
    setPlaying(playing) {
        if (this.isPlaying === playing)
            return;
        this.isPlaying = playing;
        this.root.classList.toggle('paused', !playing);
        const dot = this.root.querySelector('.sp-state-dot');
        if (dot)
            dot.dataset.on = playing ? '1' : '';
        const txt = this.root.querySelector('.sp-state-text');
        if (txt)
            txt.textContent = playing ? 'playing' : 'paused';
        if (playing)
            this.startProgress();
        else
            this.stopProgress();
    }
    /* rAF progress — transform scaleX for GPU compositing, skips writes
       when the percentage hasn't visibly moved. */
    startProgress() {
        if (this.rafId || prefersReduced()) {
            this.paintOnce();
            return;
        }
        const fill = this.root.querySelector('.sp-progress-fill');
        const cur = this.root.querySelector('.sp-t-cur');
        const end = this.root.querySelector('.sp-t-end');
        if (end)
            end.textContent = fmtTime(this.end - this.start);
        const loop = () => {
            this.rafId = requestAnimationFrame(loop);
            if (document.hidden)
                return;
            const total = this.end - this.start;
            if (total <= 0)
                return;
            const now = clamp(Date.now(), this.start, this.end);
            const pct = (now - this.start) / total;
            if (Math.abs(pct - this.lastPct) < 0.0005)
                return; // ~0.05% granularity
            this.lastPct = pct;
            if (fill)
                fill.style.transform = `scaleX(${pct})`;
            if (cur)
                cur.textContent = fmtTime(now - this.start);
        };
        this.rafId = requestAnimationFrame(loop);
    }
    paintOnce() {
        const fill = this.root.querySelector('.sp-progress-fill');
        const cur = this.root.querySelector('.sp-t-cur');
        const end = this.root.querySelector('.sp-t-end');
        if (end)
            end.textContent = fmtTime(this.end - this.start);
        if (fill)
            fill.style.transform = 'scaleX(0)';
        if (cur)
            cur.textContent = '0:00';
    }
    stopProgress() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = 0;
        }
    }
}
function boot() {
    const cfgRoot = window.__ZADE_CONFIG__;
    const cfg = {
        ...cfgRoot?.presence,
        enabled: cfgRoot?.discord?.enabled ?? cfgRoot?.presence?.enabled ?? true,
        userId: cfgRoot?.discord?.userId ?? cfgRoot?.presence?.userId ?? '',
    };
    const section = document.getElementById('presence-section');
    if (!section)
        return;
    if (cfg.enabled === false || !cfg.userId) {
        section.style.display = 'none';
        return;
    }
    if (cfg.sectionTitle) {
        const label = section.querySelector('.section-label');
        if (label)
            label.textContent = cfg.sectionTitle.toUpperCase();
    }
    const dcRoot = document.getElementById('presence-discord');
    const spRoot = document.getElementById('presence-spotify');
    if (!dcRoot || !spRoot)
        return;
    if (cfg.showDiscord === false)
        dcRoot.style.display = 'none';
    if (cfg.showSpotify === false)
        spRoot.style.display = 'none';
    // Single-column layout when one card is hidden — no empty space.
    const grid = document.getElementById('presence-grid');
    if (grid && (cfg.showDiscord === false || cfg.showSpotify === false)) {
        grid.classList.add('single');
    }
    let discord = null;
    let spotify = null;
    try {
        if (cfg.showDiscord !== false)
            discord = new DiscordCard('presence-discord');
    }
    catch { /* no root */ }
    try {
        if (cfg.showSpotify !== false)
            spotify = new SpotifyCard('presence-spotify', cfg.spotifyFallbackText ?? 'not listening to anything');
    }
    catch { /* no root */ }
    const client = new LanyardClient(cfg.userId);
    client.start();
    // Paint immediately from REST — the socket only beats it for realtime updates.
    client.fetchOnce();
    // Avatar sync with site profile (matches previous behaviour)
    let avatarSynced = false;
    const syncAvatar = (p) => {
        if (avatarSynced || cfg.avatarSync === false)
            return;
        const hash = p.discord_user.avatar;
        if (!hash)
            return;
        avatarSynced = true;
        const u = p.discord_user;
        const ext = hash.startsWith('a_') ? 'gif' : 'png';
        const url = `https://cdn.discordapp.com/avatars/${u.id}/${hash}.${ext}?size=256`;
        const wrap = document.getElementById('avatar-wrap');
        if (!wrap)
            return;
        let img = wrap.querySelector('img.avatar-img');
        if (!img) {
            img = document.createElement('img');
            img.className = 'avatar-img';
            img.alt = 'avatar';
            const ring = wrap.querySelector('.avatar-ring');
            if (ring)
                ring.insertAdjacentElement('afterend', img);
            else
                wrap.insertBefore(img, wrap.firstChild);
        }
        if (img.src !== url) {
            img.style.transition = 'opacity 0.4s ease';
            img.style.opacity = '0';
            img.onerror = () => img?.remove();
            img.onload = () => { if (img)
                img.style.opacity = '1'; };
            img.src = url;
        }
    };
    let degraded = false;
    let lastSig = '';
    client.subscribe(p => {
        const sig = signature(p);
        if (sig === lastSig)
            return; // dedupe across sockets/polls
        lastSig = sig;
        degraded = false;
        section.classList.remove('offline');
        try {
            discord?.render(p, cfg);
        }
        catch { /* one card failing must not kill the other */ }
        try {
            if (p.listening_to_spotify && p.spotify)
                spotify?.render(p);
            else
                spotify?.showFallback();
        }
        catch { /* idem */ }
        syncAvatar(p);
    });
    // If nothing arrives in 12s, show graceful degraded state.
    window.setTimeout(() => {
        if (!lastSig) {
            degraded = true;
            discord?.showError();
            spotify?.showFallback();
            section.classList.add('offline');
        }
    }, 12000);
    // Cleanup
    window.addEventListener('beforeunload', () => client.destroy());
    // Expose for admin panel / debugging
    window.ZazaPresence = { client, discord, spotify, get degraded() { return degraded; } };
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { void boot(); }, { once: true });
}
else {
    void boot();
}
