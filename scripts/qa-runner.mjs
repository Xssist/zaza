// QA runner: serves the site and runs every scripts/*-check.mjs / audit-*.mjs module.
// Usage: node scripts/qa-runner.mjs [url]   (default http://localhost:8791)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.argv[2] || "http://localhost:8791";
const PORT = Number(new URL(BASE_URL).port) || 8791;

// --- tiny static server (same as dev-server.mjs) ---
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".mp3": "audio/mpeg" };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  fs.readFile(path.join(process.cwd(), p), (e, d) => {
    if (e) { r.writeHead(404); r.end("not found"); return; }
    r.writeHead(200, { "Content-Type": mime[path.extname(p)] || "application/octet-stream" });
    r.end(d);
  });
}).listen(PORT);

await new Promise((ok) => server.on("listening", ok));

const checks = [
  "audit-runtime.mjs",
  "audit-undeclared.mjs",
  "effects-check.mjs",
  "mobile-check.mjs",
];

const browser = await chromium.launch();
let failed = 0;

for (const name of checks) {
  const mod = await import(`./${name}`);
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const run = mod.run ?? mod.default;
  if (typeof run !== "function") {
    failed++;
    console.log(`\n=== ${name} ERROR ===\nmodule has no run/default export`);
    await page.close();
    continue;
  }
  try {
    const result = await run(page, BASE_URL);
    const ok = result?.ok !== false && errors.length === 0;
    if (!ok) failed++;
    console.log(`\n=== ${name} ${ok ? "PASS" : "FAIL"} ===`);
    if (errors.length) console.log("console/page errors:", errors);
    if (result != null) console.log(JSON.stringify(result, null, 2).slice(0, 2000));
  } catch (e) {
    failed++;
    console.log(`\n=== ${name} ERROR ===\n${e}`);
  } finally {
    await page.close();
  }
}

await browser.close();
server.close();
console.log(`\n${failed ? failed + " check(s) FAILED" : "All checks passed"}`);
process.exit(failed ? 1 : 0);
