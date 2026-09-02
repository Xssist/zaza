export default async function run(page, ui) {
  await page.waitForTimeout(2000);
  return await page.evaluate(() => {
    const e = document.querySelector('.hero-copy');
    const cs = getComputedStyle(e);
    return {
      cls: e.className,
      op: cs.opacity,
      transition: cs.transitionDuration,
      animName: cs.animationName,
      animState: cs.animationPlayState,
      prefersReduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  });
}
