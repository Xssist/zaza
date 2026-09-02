export default async function run(page, ui) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  return await page.evaluate(() => {
    const out = { horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    const btn = document.querySelector('.nav-toggle, [aria-label*="menu" i], button');
    if (btn) {
      btn.click();
    }
    return out;
  }).then(async (out) => {
    await page.waitForTimeout(500);
    out.navOpen = await page.evaluate(() => {
      const nav = document.querySelector('nav, .nav-links, header');
      if (!nav) return 'no nav';
      return nav.className + ' | visible:' + (getComputedStyle(nav).opacity !== '0' && nav.offsetParent !== null);
    });
    await page.screenshot({ path: 'C:/Users/PC/Documents/zaza/zaza/qa-mobile.png', fullPage: false });
    return out;
  });
}
