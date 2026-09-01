// Smoke-test: load site, confirm engine initialized and title animates.
export default async function run(page) {
  await page.goto("http://localhost:8791", { waitUntil: "load" });
  await page.waitForFunction(
    () =>
      document.querySelector("#loading-screen")?.classList.contains("hidden"),
    null,
    { timeout: 15000 },
  );
  const t1 = await page.title();
  await page.waitForTimeout(1200);
  const t2 = await page.title();
  await page.waitForTimeout(1200);
  const t3 = await page.title();
  return { t1, t2, t3, animating: t1 !== t2 || t2 !== t3 };
}
