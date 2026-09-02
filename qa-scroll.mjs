export default async function run(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  // scroll through the page slowly to trigger reveals
  await page.evaluate(async () => {
    const h = document.body.scrollHeight;
    for (let y = 0; y < h; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
    window.scrollTo(0, h);
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'C:/Users/PC/Documents/zaza/zaza/qa-mobile-scrolled.png', fullPage: true });
  // inspect contact section contents
  const contact = await page.evaluate(() => {
    const c = document.querySelector('#contact');
    return {
      text: c.innerText.slice(0, 500),
      hasForm: !!c.querySelector('form'),
      buttons: [...c.querySelectorAll('a, button')].map(a => ({ t: a.textContent.trim().slice(0, 30), href: a.getAttribute('href') })),
    };
  });
  // check nav links actually scroll to sections
  const navTest = await page.evaluate(() => {
    const out = {};
    for (const id of ['about', 'skills', 'work', 'contact']) {
      const el = document.getElementById(id);
      out[id] = el ? { found: true, top: Math.round(el.getBoundingClientRect().top + scrollY) } : { found: false };
    }
    return out;
  });
  // audio elements
  const audio = await page.evaluate(() => [...document.querySelectorAll('audio, video')].map(a => ({ tag: a.tagName, src: a.currentSrc || a.src, muted: a.muted, controls: a.controls })));
  return { contact, navTest, audio };
}
