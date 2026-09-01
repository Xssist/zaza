export default async function (page) {
  const titles = [];
  for (let i = 0; i < 6; i++) {
    titles.push(await page.title());
    await page.waitForTimeout(700);
  }
  return { titles, changed: new Set(titles).size > 1 };
}
