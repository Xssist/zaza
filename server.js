const http = require("node:http");
const { createReadStream, existsSync, statSync } = require("node:fs");
const { extname, join, normalize, resolve, sep } = require("node:path");

const root = resolve(__dirname);
const port = Number.parseInt(process.env.PORT || "3000", 10);
const contentTypes = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".mp3": "audio/mpeg",
  ".mp4": "video/mp4", ".png": "image/png", ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8", ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
};

function sendError(response, status) {
  if (status === 404) {
    const notFoundPath = join(root, "404.html");
    if (existsSync(notFoundPath)) {
      response.writeHead(404, {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      });
      createReadStream(notFoundPath).pipe(response);
      return;
    }
  }
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(status === 404 ? "Not found" : "Method not allowed");
}

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (request.method !== "GET" && request.method !== "HEAD") return sendError(response, 405);
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^[/\\]+/, "");
  const filePath = normalize(join(root, relativePath));

  if (!filePath.startsWith(root + sep) || !existsSync(filePath) || !statSync(filePath).isFile()) return sendError(response, 404);

  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") return response.end();
  createReadStream(filePath).pipe(response);
});

server.listen(port, "0.0.0.0", () => console.log(`Zade portfolio server listening on port ${port}`));
