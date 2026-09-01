// Generates a 128x128 CSS skill icon (blue rounded square + white "}"), raw PNG via zlib.
const zlib = require("node:zlib");
const fs = require("node:fs");
const W = 128,
  H = 128;
const px = Buffer.alloc(W * H * 4);
const R = 24; // corner radius
function inside(x, y) {
  const cx = Math.min(Math.max(x, R), W - 1 - R),
    cy = Math.min(Math.max(y, R), H - 1 - R);
  return (
    (x - cx) ** 2 + (y - cy) ** 2 <= R * R ||
    (x >= R && x < W - R) ||
    (y >= R && y < H - R)
  );
}
function isBrace(x, y) {
  // Draw a "{ }" style curly brace on the right half: use a simple CSS3-like bracket
  const bx = x - 40,
    by = y - 24; // box 48x80 starting at (40,24)
  if (bx < 0 || bx >= 48 || by < 0 || by >= 80) return false;
  const t = by / 80;
  // S-shaped brace: horizontal offset per row
  const off = Math.abs(t - 0.5) < 0.06 ? 34 : t < 0.5 ? t * 68 : (1 - t) * 68;
  return bx >= off && bx <= off + 8;
}
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (!inside(x, y)) {
      px[i + 3] = 0;
      continue;
    }
    // vertical gradient #2965f1 -> #1a3fbf
    const t = y / H;
    px[i] = Math.round(41 - 15 * t);
    px[i + 1] = Math.round(101 - 40 * t);
    px[i + 2] = Math.round(241 - 50 * t);
    px[i + 3] = 255;
    if (isBrace(x, y)) {
      px[i] = 255;
      px[i + 1] = 255;
      px[i + 2] = 255;
    }
  }
}
// Build PNG
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of td) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc);
  return Buffer.concat([len, td, crcB]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.concat(
  Array.from({ length: H }, (_, y) =>
    Buffer.concat([Buffer.from([0]), px.subarray(y * W * 4, (y + 1) * W * 4)]),
  ),
);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync("icon.png", png);
console.log("icon.png written,", png.length, "bytes");
