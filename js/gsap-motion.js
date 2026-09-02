/* ============================================================
   ZADE — GSAP motion system (premium, modular)
   Timelines: intro · scroll reveals · parallax · hover/magnetic
   All motion is transform/opacity only (GPU compositor).
   ============================================================ */
(function () {
  'use strict';
  if (!window.gsap || !window.ScrollTrigger) {
    // GSAP failed to load (offline / CDN blocked) — restore all content instantly
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.dataset.gsapMotion = '0';
      document.querySelectorAll('.reveal').forEach(el => el.classList.add('in-view'));
    });
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.dataset.gsapMotion = REDUCED ? '0' : '1';
  const TOUCH   = window.matchMedia('(hover: none)').matches;
  const reducedFallback = () => { gsap.set('[data-gsap-hidden]', { clearProps: 'all' }); };

  /* ────────────────────────────────────────────
     1. TEXT SPLITTING — masked word/char reveals
  ──────────────────────────────────────────── */
  function splitText(el) {
    if (el.querySelector(':scope > .gs-mask')) return el.querySelectorAll('.gs-line-inner');
    el.dataset.split = '1';
    const words = el.textContent.split(/(\s+)/);
    const frag = document.createDocumentFragment();
    words.forEach(w => {
      if (/^\s+$/.test(w) || w === '') { frag.appendChild(document.createTextNode(' ')); return; }
      const mask = document.createElement('span');
      mask.className = 'gs-mask';
      const inner = document.createElement('span');
      inner.className = 'gs-line-inner';
      inner.textContent = w;
      mask.appendChild(inner);
      frag.appendChild(mask);
    });
    el.textContent = '';
    el.appendChild(frag);
    el.dataset.split = '1';
    return el.querySelectorAll('.gs-line-inner');
  }

  function maskedReveal(target, opts = {}) {
    const inners = splitText(target);
    return gsap.fromTo(inners,
      { yPercent: 110, opacity: 0 },
      {
        yPercent: 0, opacity: 1, duration: opts.duration || 0.85,
        ease: 'power4.out', stagger: opts.stagger || 0.035,
        delay: opts.delay || 0, force3D: true
      });
  }

  /* Elements that get cinematic masked text reveals */
  const SPLIT_SELECTORS = [
    '#profile-username', '#profile-subtitle', '#hero-greeting',
    '#about-heading', '#work-heading', '#contact-heading',
    '.skills-content h2', '.final-message p'
  ];

  function prepareSplitTargets() {
    SPLIT_SELECTORS.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => splitText(el));
    });
  }

  /* ────────────────────────────────────────────
     2. INTRO TIMELINE (runs once loading screen hides)
  ──────────────────────────────────────────── */
  function buildIntro() {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    tl.fromTo('#bg-layer',
      { opacity: 0 },
      { opacity: 1, duration: 0.7, force3D: true })
      .fromTo('.page-crumbs a, .page-crumbs .crumb-sep',
        { opacity: 0, y: -10 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.05 }, '-=0.35')
      .fromTo('.hero-time',
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.5 }, '<0.05');

    // Hero name — masked word reveal (signature moment). Split late, after
    // app.js renderProfile() has written final config text into these nodes.
    prepareSplitTargets();
    const username = document.querySelector('#profile-username');
    const subtitle = document.querySelector('#profile-subtitle');
    if (username) tl.add(maskedReveal(username, { stagger: 0.06, duration: 0.9 }), '-=0.35');
    if (subtitle) tl.add(maskedReveal(subtitle, { stagger: 0.04, duration: 0.7 }), '-=0.55');

    // Greeting + thanks line
    tl.fromTo('.hero-copy p',
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.6, stagger: 0.12, force3D: true }, '-=0.45');

    // Scroll cue
    tl.fromTo('.scroll-cue',
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.55 }, '-=0.3');

    return tl;
  }

  function runIntro() {
    if (document.documentElement.dataset.gsapIntroDone) return;
    document.documentElement.dataset.gsapIntroDone = '1';
    if (REDUCED) { reducedFallback(); return; }
    buildIntro();
  }

  /* ────────────────────────────────────────────
     3. SCROLL REVEALS (ScrollTrigger, once)
  ──────────────────────────────────────────── */
  function initScrollReveals() {
    if (REDUCED) return;

    // Section headings — masked reveal on scroll (split lazily on enter,
    // since app.js renderProfile() can rewrite these nodes after boot)
    ['#about-heading', '#work-heading', '#contact-heading', '.skills-content h2']
      .forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          ScrollTrigger.create({
            trigger: el, start: 'top 82%', once: true,
            onEnter: () => {
              const inners = splitText(el);
              gsap.fromTo(inners,
                { yPercent: 110, opacity: 0 },
                { yPercent: 0, opacity: 1, duration: 0.8,
                  ease: 'power4.out', stagger: 0.04, force3D: true });
            }
          });
        });
      });

    // Final message — big masked statement (split lazily on enter)
    document.querySelectorAll('.final-message p').forEach((p, i) => {
      ScrollTrigger.create({
        trigger: p, start: 'top 85%', once: true,
        onEnter: () => {
          const inners = splitText(p);
          gsap.fromTo(inners,
            { yPercent: 110, opacity: 0 },
            { yPercent: 0, opacity: 1, duration: 0.9,
              ease: 'power4.out', stagger: 0.05, delay: i * 0.1, force3D: true });
        }
      });
    });

    // Generic reveal blocks: fade + rise + staggered children
    gsap.utils.toArray('.about-content, .work-intro, .contact-content, .skills-content').forEach(block => {
      const kids = [block.querySelector('p, .skills-kicker'), ...block.querySelectorAll('p, dl, h2')]
        .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
      if (!kids.length) return;
      gsap.fromTo(kids,
        { opacity: 0, y: 28 },
        {
          opacity: 1, y: 0, duration: 0.85, ease: 'power3.out',
          stagger: 0.1, force3D: true,
          scrollTrigger: { trigger: block, start: 'top 78%', once: true }
        });
    });

    // Cards / grids — staggered entrance
    gsap.utils.toArray('#presence-grid, #skills-container, #projects-container').forEach(grid => {
      const items = grid.querySelectorAll('.presence-card, .skill-group, .project');
      if (!items.length) return;
      gsap.fromTo(items,
        { opacity: 0, y: 36 },
        {
          opacity: 1, y: 0, duration: 0.9, ease: 'power3.out',
          stagger: 0.12, force3D: true,
          scrollTrigger: { trigger: grid, start: 'top 80%', once: true }
        });
    });

    // Social links — stagger from below
    ScrollTrigger.create({
      trigger: '#socials-container', start: 'top 85%', once: true,
      onEnter: () => gsap.fromTo('#socials-container a, #socials-container .contact-link',
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.08, force3D: true })
    });

    // Footer
    gsap.fromTo('footer > *',
      { opacity: 0, y: 10 },
      {
        opacity: 1, y: 0, duration: 0.6, stagger: 0.1, ease: 'power2.out', force3D: true,
        scrollTrigger: { trigger: 'footer', start: 'top 95%', once: true }
      });
  }

  /* ────────────────────────────────────────────
     4. PARALLAX — subtle, scrubbed, GPU-only
  ──────────────────────────────────────────── */
  function initParallax() {
    if (REDUCED || TOUCH) return;

    // Background layer drifts slower than the page
    gsap.to('#bg-layer', {
      yPercent: 8, ease: 'none', force3D: true,
      scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: 1.2 }
    });

    // Blobs — different depths
    [['.blob-1', -6], ['.blob-2', 10], ['.blob-3', -14]].forEach(([sel, depth]) => {
      gsap.to(sel, {
        yPercent: depth, ease: 'none', force3D: true,
        scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: 1.6 }
      });
    });

    // Hero content drifts up gently as you scroll away
    gsap.to('.hero', {
      yPercent: -6, opacity: 0.35, ease: 'none', force3D: true,
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 1 }
    });

    // Section labels — slight counter-movement
    gsap.utils.toArray('.section-label').forEach(label => {
      gsap.fromTo(label,
        { y: 18 },
        {
          y: -18, ease: 'none', force3D: true,
          scrollTrigger: { trigger: label, start: 'top bottom', end: 'bottom top', scrub: 1.4 }
        });
    });
  }

  /* ────────────────────────────────────────────
     5. HOVER — magnetic pull + spring scale
  ──────────────────────────────────────────── */
  function initHover() {
    if (REDUCED || TOUCH) return;

    const MAGNETIC = 'a, button, .music-btn-mini, .theme-fab, .scroll-cue, .social-row';
    document.querySelectorAll(MAGNETIC).forEach(el => {
      if (el.dataset.gsapHover) return;
      el.dataset.gsapHover = '1';

      const xTo = gsap.quickTo(el, 'x', { duration: 0.45, ease: 'power3.out' });
      const yTo = gsap.quickTo(el, 'y', { duration: 0.45, ease: 'power3.out' });
      const sTo = gsap.quickTo(el, 'scale', { duration: 0.35, ease: 'power2.out' });
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const pull = 0.3;
        xTo(dx * pull); yTo(dy * pull); sTo(1.04);
      });
      el.addEventListener('pointerleave', () => { xTo(0); yTo(0); sTo(1); });
      el.addEventListener('pointerdown', () => sTo(0.96));
      el.addEventListener('pointerup',   () => sTo(1.04));
    });

    // Cards — depth lift on hover
    document.querySelectorAll('.presence-card, .project, .skill-group').forEach(card => {
      if (card.dataset.gsapHover) return;
      card.dataset.gsapHover = '1';
      const yTo = gsap.quickTo(card, 'y', { duration: 0.5, ease: 'power3.out' });
      card.addEventListener('pointerenter', () => yTo(-5));
      card.addEventListener('pointerleave', () => yTo(0));
    });
  }

  /* ────────────────────────────────────────────
     BOOT — wait for the loading screen to finish
  ──────────────────────────────────────────── */
  function boot() {
    initScrollReveals();
    initParallax();
    initHover();
    ScrollTrigger.refresh();

    const start = () => runIntro();
    window.addEventListener('zade:intro-go', start, { once: true });
    // Fallback: if loading screen never appears / event missed, start after 3s
    setTimeout(() => {
      if (!document.documentElement.dataset.gsapIntroDone) start();
    }, 3200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.ZazaGsap = { runIntro, maskedReveal, splitText };
})();

