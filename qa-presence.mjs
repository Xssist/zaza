export default async function run(page) {
  // 1. Instrument: capture page errors + log
  const errors = [];
  page.on("pageerror", (e) =>
    errors.push("pageerror: " + String(e).slice(0, 200)),
  );
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning")
      errors.push(m.type() + ": " + m.text().slice(0, 200));
  });

  // 2. Reload with instrumentation attached
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // 3. Probe globals
  const probe = await page.evaluate(() => {
    const out = {};
    try {
      out.cfg = typeof window.__ZADE_CONFIG__;
    } catch (e) {
      out.cfg = "ERR:" + e.message;
    }
    try {
      out.presence = typeof window.ZazaPresence;
    } catch (e) {
      out.presence = "ERR:" + e.message;
    }
    try {
      out.discordCard =
        document.getElementById("presence-discord")?.className ?? "no-el";
    } catch (e) {
      out.discordCard = "ERR:" + e.message;
    }
    try {
      out.scripts = [...document.scripts].map((s) =>
        s.src
          ? s.src.split("/").pop()
          : "inline(" + s.textContent.slice(0, 30).replace(/\n/g, " ") + ")",
      );
    } catch (e) {
      out.scripts = "ERR:" + e.message;
    }
    return out;
  });

  // 4. Wait up to 20s for the presence card to go ready
  let ready = false;
  try {
    await page.waitForSelector("#presence-discord.ready", { timeout: 20000 });
    ready = true;
  } catch {
    ready = false;
  }

  const state = await page.evaluate(() => ({
    dc: document.getElementById("presence-discord")?.className ?? null,
    dot: document.querySelector(".pc-status-dot")?.dataset?.status ?? null,
    name: document.querySelector(".pc-name")?.textContent ?? null,
    status: document.querySelector(".pc-status")?.textContent ?? null,
    spClass: document.getElementById("presence-spotify")?.className ?? null,
    spTitle: document.querySelector(".sp-title")?.textContent ?? null,
    spFill:
      document.querySelector(".sp-progress-fill")?.style.transform ?? null,
    exposed: typeof window.ZazaPresence,
    cfgPresent: !!window.__ZADE_CONFIG__,
  }));

  return { probe, ready, state, errors: errors.slice(0, 10) };
}
