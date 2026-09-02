export default async function run(page, ui) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('about:blank');
  await page.goto('http://localhost:8791');
  await page.waitForTimeout(4500);
  const vis = await page.evaluate(() => {
    const pick = s => { const el = document.querySelector(s); if (!el) return 'missing'; return getComputedStyle(el).opacity; };
    return { heroCopy: pick('.hero-copy p'), cue: pick('.scroll-cue'), bg: pick('#bg-layer'), about: pick('.about-content p'), crumb: pick('.page-crumbs a') };
  });
  const aboutRevealed = await page.evaluate(() => { window.scrollTo(0, 800); return true; });
  await page.waitForTimeout(800);
  const flag = await page.evaluate(() => document.documentElement.dataset.gsapMotion);
  return { vis, aboutRevealed, flag };
}
