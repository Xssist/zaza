export default async function(page, ui) {
  const grid = page.locator('#title-preview-grid');
  const cellsBefore = await grid.locator('div').count();

  // Open the preview
  await page.locator('#btn-title-preview').click();
  await page.waitForTimeout(2500);

  const cellsAfter = await grid.locator('> div').count();
  const sample = await page.evaluate(() => {
    const out = [...document.querySelectorAll('#title-preview-grid > div > div:last-child')];
    return { cells: out.length, nonEmpty: out.filter(d => d.textContent.length > 0).length, samples: out.slice(0, 5).map(d => d.textContent) };
  });

  // Stop button should be enabled now
  const stopEnabled = await page.locator('#btn-title-preview-stop').isEnabled();
  await page.locator('#btn-title-preview-stop').click();
  await page.waitForTimeout(300);
  const frozen = await page.evaluate(() => {
    const out = [...document.querySelectorAll('#title-preview-grid > div > div:last-child')].map(d => d.textContent);
    return out.slice(0, 3);
  });

  return { cellsBefore, cellsAfter, sample, stopEnabled, frozenAfterStop: frozen };
}

// --- v2 appended: original body kept above but shadowed by re-export below ---
export default async function(page, ui) {
  await page.evaluate(() => {
    document.getElementById('a-login')?.remove();
    document.getElementById('a-dash')?.classList.remove('hidden');
  });

  const click = await page.locator('#btn-title-preview').click({ timeout: 5000 }).then(() => true).catch(e => 'click failed: ' + e.message.split('\n')[0]);
  await page.waitForTimeout(2500);

  const sample = await page.evaluate(() => {
    const out = [...document.querySelectorAll('#title-preview-grid > div > div:last-child')];
    const labels = [...document.querySelectorAll('#title-preview-grid > div > div:first-child')].map(d => d.textContent);
    return {
      cells: out.length,
      labelsFirst5: labels.slice(0, 5),
      labelsLast3: labels.slice(-3),
      nonEmpty: out.filter(d => d.textContent.length > 0).length,
      samples: out.slice(0, 4).map(d => d.textContent),
    };
  });

  const stopEnabled = await page.locator('#btn-title-preview-stop').isEnabled();
  await page.locator('#btn-title-preview-stop').click({ timeout: 5000 });
  const f1 = await page.evaluate(() => document.querySelector('#title-preview-grid > div > div:last-child')?.textContent);
  await page.waitForTimeout(1200);
  const f2 = await page.evaluate(() => document.querySelector('#title-preview-grid > div > div:last-child')?.textContent);

  return { click, sample, stopEnabled, frozen: { t0: f1, t1: f2, stopped: f1 === f2 } };

