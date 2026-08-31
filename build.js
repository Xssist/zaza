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

(async () => {
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
