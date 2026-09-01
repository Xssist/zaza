// Tiny static server for local QA only. Run: node scripts/dev-server.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
};
const root = process.cwd();

http
  .createServer((q, r) => {
    let p = decodeURIComponent(q.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const f = path.join(root, p);
    fs.readFile(f, (e, d) => {
      if (e) {
        r.writeHead(404);
        r.end("not found");
        return;
      }
      r.writeHead(200, {
        "Content-Type": mime[path.extname(f)] || "application/octet-stream",
      });
      r.end(d);
    });
  })
  .listen(8791, () => console.log("http://localhost:8791"));
