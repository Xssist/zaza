const { existsSync, statSync, readFileSync, writeFileSync } = require("node:fs");
const { minify } = require("terser");

const requiredFiles = ["index.html", "404.html", "admin.html", "config.json", "worker.js"];
const missingFiles = requiredFiles.filter((file) => !existsSync(file) || !statSync(file).isFile());

if (missingFiles.length > 0) {
  throw new Error(`Missing required site files: ${missingFiles.join(", ")}`);
}

const bundles = [
  { src: "js/motion.js", out: "js/motion.min.js" },
  { src: "js/app.js",    out: "js/app.min.js" },
];

/** Replace the inline config JSON inside an HTML file so it always mirrors
    config.json — the hand-edited copy used to drift out of sync. */
function syncInlineConfig(htmlPath, configJson) {
  const html = readFileSync(htmlPath, "utf8");
  const marker = "window.__ZADE_CONFIG__ = ";
  const start = html.indexOf(marker);
  if (start === -1) return false;
  const valueStart = start + marker.length;
  const end = html.indexOf(";", valueStart);
  if (end === -1) return false;
  const updated = html.slice(0, valueStart) + configJson + html.slice(end);
  if (updated !== html) {
    writeFileSync(htmlPath, updated);
    console.log(`${htmlPath}: inline __ZADE_CONFIG__ synced with config.json`);
  }
  return true;
}

(async () => {
  // Inline config blocks must mirror config.json exactly.
  const configJson = readFileSync("config.json", "utf8").trim();
  let inlineSynced = false;
  for (const htmlPath of ["index.html", "admin.html"]) {
    if (syncInlineConfig(htmlPath, configJson)) inlineSynced = true;
  }
  if (!inlineSynced) console.warn("No inline __ZADE_CONFIG__ block found in any HTML file.");

  let before = 0;
  let after = 0;
  for (const { src, out } of bundles) {
    const code = readFileSync(src, "utf8");
    const result = await minify(code, {
      module: false,
      compress: { passes: 2 },
      mangle: true,
      format: { comments: false },
    });
    if (!result.code) throw new Error(`Minification produced no output for ${src}`);
    writeFileSync(out, result.code);
    before += code.length;
    after += result.code.length;
    console.log(`${src} -> ${out}: ${(code.length / 1024).toFixed(1)} kB -> ${(result.code.length / 1024).toFixed(1)} kB`);
  }
  console.log(`Total JS: ${(before / 1024).toFixed(1)} kB -> ${(after / 1024).toFixed(1)} kB (-${(100 - (after / before) * 100).toFixed(0)}%)`);
  console.log("Static site build completed.");
})();
