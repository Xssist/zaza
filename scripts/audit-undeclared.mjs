// Temporary audit helper: find identifiers used in app.js but never declared anywhere in the file.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const s = readFileSync(path.join(here, "..", "js", "app.js"), "utf8");
const declared = new Set();
for (const m of s.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g))
  declared.add(m[1]);
for (const m of s.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g))
  declared.add(m[1]);
for (const m of s.matchAll(/\b([A-Za-z_$][\w$]*)\s*[:=]\s*(?:function|\()/g))
  declared.add(m[1]);
const globals = new Set([
  "window",
  "document",
  "navigator",
  "location",
  "localStorage",
  "fetch",
  "URL",
  "WebSocket",
  "Audio",
  "AudioContext",
  "webkitAudioContext",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "performance",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "AbortController",
  "Image",
  "Math",
  "Date",
  "JSON",
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Promise",
  "Error",
  "console",
  "Set",
  "Map",
  "parseInt",
  "parseFloat",
  "isNaN",
  "undefined",
  "IntersectionObserver",
  "ResizeObserver",
  "CustomEvent",
  "Event",
  "Blob",
  "FileReader",
  "history",
  "screen",
  "matchMedia",
  "getComputedStyle",
  "innerWidth",
  "innerHeight",
  "devicePixelRatio",
  "ZazaMotion",
  "__ZADE_CONFIG__",
  "globalThis",
  "self",
  "btoa",
  "atob",
  "crypto",
  "TextEncoder",
  "TextDecoder",
  "queueMicrotask",
  "structuredClone",
  "Node",
  "Element",
  "HTMLElement",
]);
const keywords =
  /^(if|for|while|switch|catch|return|function|const|let|var|new|typeof|instanceof|in|of|do|else|break|continue|delete|void|yield|await|async|class|extends|super|this|null|true|false|try|throw|case|default|export|import|from|with|debugger|static|get|set|arguments)$/;
const used = new Set();
for (const m of s.matchAll(/\b([A-Za-z_][\w]*)\b/g)) used.add(m[1]);
const missing = [...used].filter(
  (u) => !declared.has(u) && !globals.has(u) && !keywords.test(u),
);
const result = [...new Set(missing)];
console.log("possibly-undeclared:", result.join(", ") || "none");

export function run() {
  return { ok: true, possiblyUndeclared: result };
}
export default run;
