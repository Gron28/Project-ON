// setup/icon.mjs - the app icon, drawn in code (no image tools needed): a dark metal orb with a warm core showing
// through. Writes .setup/being.png (256 px) and .setup/being.ico (PNG-compressed ICO, 16-256 px).
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** RGBA pixels -> PNG */
export function png(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/** the orb, supersampled */
export function orb(size) {
  const out = Buffer.alloc(size * size * 4), ss = 3, L = [-0.45, 0.55, 0.7], ll = Math.hypot(...L);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const u = ((x + (sx + 0.5) / ss) / size) * 2 - 1, v = 1 - ((y + (sy + 0.5) / ss) / size) * 2, R = 0.86, d2 = (u * u + v * v) / (R * R);
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2), nx = u / R, ny = v / R;
      const dif = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / ll), rim = Math.pow(1 - nz, 3);
      const spec = Math.pow(Math.max(0, (nx * -0.3 + ny * 0.5 + nz * 0.81)), 40);
      const core = Math.exp(-((u + 0.08) ** 2 + (v + 0.1) ** 2) * 9) * nz;   // the light inside, seen through the metal
      r += 0.07 + 0.16 * dif + 0.55 * rim * 0.6 + spec * 0.95 + core * 1.0;
      g += 0.07 + 0.17 * dif + 0.5 * rim * 0.55 + spec * 0.95 + core * 0.72;
      b += 0.09 + 0.21 * dif + 0.55 * rim * 0.75 + spec * 1.0 + core * 0.45;
      a += 1;
    }
    const n = ss * ss, k = (y * size + x) * 4, al = a / n;
    if (a) { out[k] = Math.min(255, (r / a) * 255); out[k + 1] = Math.min(255, (g / a) * 255); out[k + 2] = Math.min(255, (b / a) * 255); }
    out[k + 3] = Math.round(al * 255);
  }
  return out;
}
/** PNG images -> ICO (Vista+ PNG entries) */
export function ico(images) {
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length; const dir = [];
  for (const { size, data } of images) {
    const e = Buffer.alloc(16); e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    dir.push(e); offset += data.length;
  }
  return Buffer.concat([head, ...dir, ...images.map((i) => i.data)]);
}
export async function writeIcons(root) {
  const dir = path.join(root, '.setup'); await fs.mkdir(dir, { recursive: true });
  const sizes = [16, 24, 32, 48, 64, 128, 256], images = sizes.map((size) => ({ size, data: png(orb(size), size) }));
  await fs.writeFile(path.join(dir, 'being.png'), images.at(-1).data);
  await fs.writeFile(path.join(dir, 'being-32.png'), images[2].data);
  await fs.writeFile(path.join(dir, 'being.ico'), ico(images));
  return { png: path.join(dir, 'being.png'), ico: path.join(dir, 'being.ico') };
}
