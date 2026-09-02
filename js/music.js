/* ============================================================
   ZADE — music.js  (music player module)
   Extracted from app.js initMusic() so the player is testable
   and reusable. Exposes window.ZadeMusicPlayer.
   ============================================================ */
"use strict";

(function () {
  const $ = (s, ctx = document) => ctx.querySelector(s);
  const fmtTime = (s) => {
    if (!s || isNaN(s)) return "0:00";
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  };

  class MusicPlayer {
    constructor(S, cfg) {
      this.S = S;
      this.cfg = cfg || { enabled: false, defaultVolume: 0.5, tracks: [] };
      this.cfg.tracks = Array.isArray(this.cfg.tracks) ? this.cfg.tracks : [];

      this.S.audioEl = new Audio();
      this.S.audioEl.volume = this.cfg.defaultVolume ?? 0.5;
      this.S.audioEl.crossOrigin = "anonymous";

      this._wireAudioEvents();
      this._wireControls();
      this.loadTrack(0);
      this.S.playPause = () => this.playPause();
    }

    /* Lazily create the Web Audio graph on first play. */
    ensureCtx() {
      const S = this.S;
      if (S.audioCtx) {
        if (S.audioCtx.state === "suspended") S.audioCtx.resume();
        return;
      }
      try {
        S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        S.analyser = S.audioCtx.createAnalyser();
        S.analyser.fftSize = 256;
        S.gainNode = S.audioCtx.createGain();
        S.gainNode.gain.value = S.audioEl.volume;
        S.sourceNode = S.audioCtx.createMediaElementSource(S.audioEl);
        S.sourceNode.connect(S.analyser);
        S.analyser.connect(S.gainNode);
        S.gainNode.connect(S.audioCtx.destination);
        if (typeof window.startVisualizer === "function")
          window.startVisualizer();
      } catch (e) {
        console.warn("Web Audio setup failed:", e);
      }
    }

    loadTrack(idx) {
      const track = this.cfg.tracks[idx];
      if (!track) return;
      const S = this.S;
      S.trackIdx = idx;

      const titleEl = $("#music-title-mini");
      const artistEl = $("#music-artist-mini");
      const coverEl = $("#music-cover-mini");
      if (titleEl) titleEl.textContent = track.title || "Unknown";
      if (artistEl) artistEl.textContent = track.artist || "—";
      if (coverEl) {
        if (track.cover) {
          const cover = window.normalizeAssetPath
            ? window.normalizeAssetPath(track.cover) ||
              window.safeExternalUrl(track.cover)
            : track.cover;
          if (cover)
            coverEl.style.backgroundImage = `url("${cover.replace(/"/g, "%22")}")`;
          else coverEl.style.backgroundImage = "";
          coverEl.replaceChildren();
        } else {
          coverEl.style.backgroundImage = "";
          const icon = document.createElement("i");
          icon.className = "fas fa-music";
          coverEl.replaceChildren(icon);
        }
      }
      S.audioEl.src = window.normalizeAssetPath
        ? window.normalizeAssetPath(track.src)
        : track.src;
      S.audioEl.load();
      const fill = $("#music-progress-fill-mini");
      const time = $("#music-time-mini");
      if (fill) fill.style.width = "0%";
      if (time) time.textContent = "0:00";
    }

    playPause() {
      this.ensureCtx();
      const S = this.S;
      if (S.audioEl.paused) {
        S.audioEl
          .play()
          .then(() => {
            S.musicPlaying = true;
            this._updatePlayBtn(true);
            $("#music-cover-mini")?.classList.add("playing");
          })
          .catch((e) => console.warn("Playback error:", e));
      } else {
        S.audioEl.pause();
        S.musicPlaying = false;
        this._updatePlayBtn(false);
        $("#music-cover-mini")?.classList.remove("playing");
      }
    }

    setVolume(v) {
      const vol = Math.max(0, Math.min(1, Number(v)));
      if (isNaN(vol)) return;
      this.S.audioEl.volume = vol;
      if (this.S.gainNode) this.S.gainNode.gain.value = vol;
    }

    next() {
      if (!this.cfg.tracks.length) return;
      this.loadTrack((this.S.trackIdx + 1) % this.cfg.tracks.length);
      if (this.S.musicPlaying) this.S.audioEl.play().catch(() => {});
    }

    prev() {
      if (!this.cfg.tracks.length) return;
      const len = this.cfg.tracks.length;
      this.loadTrack((this.S.trackIdx - 1 + len) % len);
      if (this.S.musicPlaying) this.S.audioEl.play().catch(() => {});
    }

    _updatePlayBtn(playing) {
      const btn = $("#play-pause-btn");
      if (!btn) return;
      btn.innerHTML = playing
        ? '<i class="fas fa-pause" aria-hidden="true"></i>'
        : '<i class="fas fa-play" aria-hidden="true"></i>';
      btn.className = "music-btn-mini play-btn";
      btn.setAttribute("aria-label", playing ? "Pause" : "Play");
      btn.setAttribute("aria-pressed", String(playing));
    }

    _wireAudioEvents() {
      const S = this.S;
      S.audioEl.addEventListener("timeupdate", () => {
        if (!S.audioEl.duration) return;
        const pct = (S.audioEl.currentTime / S.audioEl.duration) * 100;
        const fill = $("#music-progress-fill-mini");
        const time = $("#music-time-mini");
        if (fill) fill.style.width = pct + "%";
        if (time) time.textContent = fmtTime(S.audioEl.currentTime);
      });
      S.audioEl.addEventListener("ended", () => {
        if (this.cfg.tracks.length > 1) {
          this.loadTrack((S.trackIdx + 1) % this.cfg.tracks.length);
          S.audioEl.play().catch(() => {});
        } else {
          S.musicPlaying = false;
          this._updatePlayBtn(false);
          $("#music-cover-mini")?.classList.remove("playing");
        }
      });
    }

    _syncSliderFill(el) {
      const min = parseFloat(el.min) || 0;
      const max = parseFloat(el.max) || 1;
      const pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
      el.style.setProperty("--pct", pct + "%");
    }

    _wireControls() {
      const bar = $("#music-bar");
      if (bar) bar.style.display = "none";

      const volSlider = $("#volume-slider");
      if (volSlider) {
        volSlider.value = this.S.audioEl.volume;
        this._syncSliderFill(volSlider);
        volSlider.addEventListener("input", (e) => {
          this.setVolume(e.target.value);
          this._syncSliderFill(e.target);
        });
      }

      const prog = $("#music-progress-mini");
      if (prog) {
        prog.addEventListener("click", (e) => {
          if (!this.S.audioEl.duration) return;
          this.S.audioEl.currentTime =
            (e.offsetX / prog.offsetWidth) * this.S.audioEl.duration;
        });
      }

      $("#play-pause-btn")?.setAttribute("aria-label", "Play");
      $("#play-pause-btn")?.setAttribute("aria-pressed", "false");
      $("#prev-btn")?.setAttribute("aria-label", "Previous track");
      $("#next-btn")?.setAttribute("aria-label", "Next track");
      $("#play-pause-btn")?.addEventListener("click", () => this.playPause());
      $("#prev-btn")?.addEventListener("click", () => this.prev());
      $("#next-btn")?.addEventListener("click", () => this.next());
    }
  }

  window.MusicPlayer = MusicPlayer;
})();
