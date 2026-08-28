const { existsSync, statSync } = require("node:fs");

const requiredFiles = ["index.html", "admin.html", "config.json", "worker.js"];
const missingFiles = requiredFiles.filter((file) => !existsSync(file) || !statSync(file).isFile());

if (missingFiles.length > 0) {
  throw new Error(`Missing required site files: ${missingFiles.join(", ")}`);
}

console.log("Static site build validation completed.");
