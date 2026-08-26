/* Shared lightweight spring motion system. Uses transform/opacity only for smooth compositor animation. */
(function (root) {
  'use strict';
  const presets = {
    default: { stiffness: 180, damping: 20, mass: 1 },
    smooth: { stiffness: 140, damping: 22, mass: 1 },
    snappy: { stiffness: 260, damping: 20, mass: 0.8 },
    gentle: { stiffness: 100, damping: 24, mass: 1 }
  };
  const reduced = () => root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function spring(el, target, preset = 'default', done) {
    if (!el) return;
    const p = typeof preset === 'object' ? preset : presets[preset] || presets.default;
    const from = el._springValue || { x: 0, y: 0, scale: 1, rotate: 0 };
    const goal = { ...from, ...target };
    if (reduced()) { el.style.transform = `translate3d(${goal.x}px,${goal.y}px,0) scale(${goal.scale}) rotate(${goal.rotate}deg)`; el._springValue = goal; done?.(); return; }
    cancelAnimationFrame(el._springFrame);
    let value = { ...from }, velocity = { x: 0, y: 0, scale: 0, rotate: 0 }, last = performance.now();
    const tick = now => {
      const dt = Math.min((now - last) / 1000, 0.032); last = now;
      let settled = true;
      for (const key of ['x', 'y', 'scale', 'rotate']) {
        const force = (goal[key] - value[key]) * p.stiffness;
        velocity[key] += (force - velocity[key] * p.damping) / p.mass * dt;
        value[key] += velocity[key] * dt;
        if (Math.abs(goal[key] - value[key]) > 0.001 || Math.abs(velocity[key]) > 0.001) settled = false;
      }
      el.style.transform = `translate3d(${value.x}px,${value.y}px,0) scale(${value.scale}) rotate(${value.rotate}deg)`;
      el._springValue = value;
      if (settled) { el.style.transform = `translate3d(${goal.x}px,${goal.y}px,0) scale(${goal.scale}) rotate(${goal.rotate}deg)`; el._springValue = goal; done?.(); return; }
      el._springFrame = requestAnimationFrame(tick);
    };
    el._springFrame = requestAnimationFrame(tick);
  }
  function bind(selector, options = {}) {
    document.querySelectorAll(selector).forEach(el => {
      if (el.dataset.springBound) return;
      el.dataset.springBound = 'true';
      el.style.willChange = 'transform';
      const hover = options.hover || { scale: 1.03, y: -2 };
      const rest = { x: 0, y: 0, scale: 1, rotate: 0 };
      el.addEventListener('pointerenter', () => spring(el, hover, options.preset || 'snappy'));
      el.addEventListener('pointerleave', () => spring(el, rest, options.preset || 'smooth'));
      el.addEventListener('pointerdown', () => spring(el, { ...hover, scale: .97 }, 'snappy'));
      el.addEventListener('pointerup', () => spring(el, hover, 'snappy'));
    });
  }
  function reveal(selector = '.reveal') {
    document.querySelectorAll(selector).forEach((el, i) => {
      el.classList.add('spring-reveal');
      el.style.setProperty('--spring-delay', `${Math.min(i * 70, 420)}ms`);
    });
  }
  root.ZazaMotion = { presets, spring, bind, reveal };
})(window);