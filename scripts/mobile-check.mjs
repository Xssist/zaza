// Mobile viewport check: verify mobile-specific optimizations engage.
export default async function run(page) {
  await page.setViewportSize({ width: 375, height: 667, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const vp = page.viewportSize();
  return await page.evaluate(`(() => {
    const blob = document.querySelector('.blob-1');
    const cv = document.getElementById('particles-canvas');
    const dpr = cv ? (cv.width / cv.getBoundingClientRect().width) : 0;
    const weather = document.querySelectorAll('[style*="wFall"]').length;
    return {
      viewport: ${JSON.stringify({ w: 375, h: 667 })},
      blobHidden: blob ? getComputedStyle(blob).display === 'none' : 'no blobs',
      particleCanvasWidth: cv ? cv.width : 0,
      particleDpr: Math.round(dpr * 10) / 10,
      weatherFlakes: weather,
      loadingHidden: document.querySelector('#loading-screen')?.classList.contains('hidden'),
    };
  })()`);
}
