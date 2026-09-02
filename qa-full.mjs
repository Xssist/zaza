export default async function run(page, ui) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1200);
  // full page screenshot on mobile
  await page.screenshot({ path: 'C:/Users/PC/Documents/zaza/zaza/qa-mobile-full.png', fullPage: true });
  // check contact form
  const formInfo = await page.evaluate(() => {
    const f = document.querySelector('form');
    if (!f) return { form: false };
    const fields = [...f.querySelectorAll('input, textarea')].map(el => ({ name: el.name || el.id, type: el.type, required: el.required }));
    return { form: true, fields, method: f.method, action: f.action };
  });
  // try submitting empty form
  let emptySubmit = null;
  if (formInfo.form) {
    await page.click('form button[type="submit"], form button:not([type]), form input[type="submit"]').catch(() => {});
    await page.waitForTimeout(400);
    emptySubmit = await page.evaluate(() => {
      const f = document.querySelector('form');
      const invalid = [...f.querySelectorAll(':invalid')].map(e => e.name || e.id);
      return { blocked: invalid.length > 0, invalid, msg: document.querySelector('.form-status, .form-message')?.textContent || null };
    });
  }
  // check all sections visible / not overflowing on mobile
  const sections = await page.evaluate(() => {
    return [...document.querySelectorAll('section, main > div')].map(s => {
      const r = s.getBoundingClientRect();
      return { id: s.id || s.className.slice(0, 30), h: Math.round(r.height), overflows: s.scrollWidth > s.clientWidth + 2 };
    });
  });
  return { formInfo, emptySubmit, sections };
}
