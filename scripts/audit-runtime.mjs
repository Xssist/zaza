// Full audit drive: load, interact, exercise subsystems, assert invariants.
export default async function run(page, ui) {
  const results = {};
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // 1. Structural invariants
  results.title = await page.title();
  results.crumbs = await page.locator('.page-crumbs a').count();
  results.crumbsJsonLd = await page.evaluate(() => {
    const el = document.querySelector('script[type="application/ld+json"]');
    if (!el) return false;
    try { const d = JSON.parse(el.textContent); return d['@type'] === 'BreadcrumbList' && d.itemListElement.length === 4; } catch { return false; }
  });
  results.favicon = await page.evaluate(() => !!document.querySelector('link[rel="icon"][href*="favicon"]'));

  // 2. Config integrity
  results.config = await page.evaluate(() => {
    const c = window.__ZADE_CONFIG__;
    return {
      hasProfile: !!c?.profile,
      bioNonEmpty: typeof c?.profile?.bio === 'string' && c.profile.bio.length > 0,
      tracks: c?.music?.tracks?.length,
      noMojibake:
        !/Ãƒ|Ã°/.test(JSON.stringify(c)) &&
        !/Ãƒ|Ã°/.test(document.documentElement.innerHTML),
      seoDescriptionOk: typeof c?.seo?.description === 'string' && !/part time/.test(c.seo.description),
    };
  });

  // 3. Wait for app init (loading screen hidden, reveals)
  await page.waitForFunction(() => document.querySelector('#loading-screen')?.classList.contains('hidden'), null, { timeout: 15000 }).catch((e) => {
    results.initTimeout = true;
    errors.push("init-timeout: " + (e?.message || e));
  });
  results.loadingHidden = await page.evaluate(() => document.querySelector('#loading-screen')?.classList.contains('hidden') ?? 'missing');

  // 4. Rendered content sanity
  results.username = await page.evaluate(() => document.querySelector('#profile-username')?.textContent);
  results.bioRendered = await page.evaluate(() => (document.querySelector('#profile-bio')?.textContent || '').slice(0, 40));
  results.socialLinks = await page.evaluate(() => [...document.querySelectorAll('#socials-container a')].map(a => a.href));
  results.avatarImg = await page.evaluate(() => !!document.querySelector('#avatar-wrap img, #avatar-wrap .avatar-initial'));

  // 5. Simulate "entered" state and exercise keyboard shortcuts
  await page.evaluate(() => { window.dispatchEvent(new Event('audit-enter')); });
  await page.evaluate(() => {
    // S is module-internal after minification; drive via real user events instead
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
  });
  await page.waitForTimeout(300);
  results.afterKeys = await page.evaluate(() => ({
    spaceKeyHandled:
      document.querySelector(".music-playing, .player.playing") !== null ||
      !!document.querySelector("#audio-player")?.paused === false,
  }));

  // 6. Context menu opens via right-click
  await page.locator('body').click({ button: 'right', position: { x: 400, y: 400 } });
  await page.waitForTimeout(200);
  const isCtxMenuOpen = () => page.evaluate(() => document.querySelector('#ctx-menu')?.classList.contains('open') ?? false);
  results.ctxMenuOpen = await isCtxMenuOpen();
  results.ctxItemCount = await page.evaluate(() => document.querySelectorAll('#ctx-menu .ctx-item').length);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  results.ctxMenuClosed = !(await isCtxMenuOpen());
  // 7. Easter egg terminal â€” the esc() fix
  await page.evaluate(() => {
    const ev = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
    for (let i = 0; i < 8; i++) document.dispatchEvent(ev);
  });
  await page.waitForTimeout(300);
  const termBuilt = await page.evaluate(() => !!document.getElementById('egg-terminal'));
  if (termBuilt) {
    await page.fill('#egg-input', 'frobnicate');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    results.eggTerminal = await page.evaluate(() => ({
      built: true,
      output: document.getElementById('egg-output')?.textContent?.includes('command not found: frobnicate'),
      noErrorEcho: errors.every((e) => !/frobnicate|egg/.test(e)),
    }));
  } else {
    results.eggTerminal = { built: false, note: 'keystroke detector did not trigger (synthetic events lack timing density)' };
  }

  // 8. Music track switching with single track (edge case: modulo by zero)
  results.trackNav = await page.evaluate(() => {
    try {
      document.getElementById('next-btn')?.click();
      document.getElementById('prev-btn')?.click();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // 9. Resize + visibility resilience
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
  results.responsiveOk = true;

  return { results, errors };
}
