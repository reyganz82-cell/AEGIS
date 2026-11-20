// Membuat ikon PWA (PNG) tanpa dependency: node scripts/make-icons.mjs
// Menghasilkan icons/icon-192.png, icons/icon-512.png, icons/apple-touch-icon.png (180px).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "icons");

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Ikon hologram AEGIS: cincin bersegmen + inti bercahaya, di dalam zona aman maskable (radius ≤ 40%). */
function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2, u = size / 512; // satuan relatif 512px
  const bg = [2, 6, 13], cyan = [0, 229, 255];
  const ring = (r, R, w, aa) => 1 - smooth(w / 2 - aa, w / 2 + aa, Math.abs(r - R)); // 1 di atas cincin
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy) / u;
      let ang = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      ang = (ang + 360) % 360;
      const aa = 1.2;
      let col = bg.slice();
      const mix = (rgb, a) => { for (let i = 0; i < 3; i++) col[i] = col[i] * (1 - a) + rgb[i] * a; };
      mix(cyan, 0.10 * (1 - smooth(60, 205, r))); // aura
      // cincin luar bersegmen (celah di 4 tempat)
      const gap = [0, 90, 180, 270].some((g) => Math.abs(((ang - g + 540) % 360) - 180) > 168);
      mix(cyan, ring(r, 190, 10, aa) * (gap ? 0.15 : 0.95));
      mix(cyan, ring(r, 158, 3, aa) * 0.55);
      // busur tebal tengah
      const arc = ang % 120 < 92;
      mix(cyan, ring(r, 122, 18, aa) * (arc ? 0.9 : 0.12));
      mix(cyan, ring(r, 86, 4, aa) * 0.8);
      // inti bercahaya
      const core = 1 - smooth(34, 62, r);
      mix([255, 255, 255], Math.pow(1 - smooth(0, 38, r), 1.4));
      mix(cyan, core * 0.85);
      const i = (y * size + x) * 4;
      buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = 255;
    }
  }
  return buf;
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  fs.writeFileSync(path.join(OUT, name), png(size, render(size)));
  console.log("dibuat icons/" + name);
}
