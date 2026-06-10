/**
 * Generates the app icon (Gantt chart — 3 colored horizontal bars on dark BG).
 * Outputs:
 *   build/icon.ico  — Windows (16/32/48/256 px, PNG-in-ICO)
 *   build/icon.png  — Linux (256 px)
 *
 * Uses only Node.js built-ins (zlib, fs, path). No extra packages needed.
 */
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(__dirname, '..', 'build');
fs.mkdirSync(BUILD, { recursive: true });

// ── CRC32 ─────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── PNG chunk helper ──────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length, 0);
  const crcIn = Buffer.concat([t, data]);
  const crcOut = Buffer.allocUnsafe(4);
  crcOut.writeUInt32BE(crc32(crcIn), 0);
  return Buffer.concat([len, t, data, crcOut]);
}

// ── PNG encoder ───────────────────────────────────────────────────────────────
// pixels: Uint8Array of size*size*4 (RGBA row-major)
function encodePNG(size, pixels) {
  const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // Raw scanlines: [filter=0, r,g,b,a, r,g,b,a, ...]
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // None filter
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = y * stride + 1 + x * 4;
      raw.set(pixels.subarray(src, src + 4), dst);
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([SIG, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ── ICO builder (PNG-in-ICO) ──────────────────────────────────────────────────
function buildICO(entries) {
  // entries: [{size, png}]
  const DIR_HDR = 6;
  const DIR_ENTRY = 16;
  let dataOffset = DIR_HDR + DIR_ENTRY * entries.length;

  const header = Buffer.alloc(DIR_HDR + DIR_ENTRY * entries.length);
  header.writeUInt16LE(0, 0);                  // reserved
  header.writeUInt16LE(1, 2);                  // type = ICO
  header.writeUInt16LE(entries.length, 4);     // image count

  const chunks = [header];
  entries.forEach(({ size, png }, i) => {
    const base = DIR_HDR + i * DIR_ENTRY;
    header[base]     = size === 256 ? 0 : size; // width  (0 means 256)
    header[base + 1] = size === 256 ? 0 : size; // height
    header[base + 2] = 0;                        // color count
    header[base + 3] = 0;                        // reserved
    header.writeUInt16LE(1,  base + 4);          // planes
    header.writeUInt16LE(32, base + 6);          // bit count
    header.writeUInt32LE(png.length, base + 8);  // image size
    header.writeUInt32LE(dataOffset, base + 12); // offset
    dataOffset += png.length;
    chunks.push(png);
  });

  return Buffer.concat(chunks);
}

// ── Icon renderer ─────────────────────────────────────────────────────────────
// Composites an RGBA color onto pixels[x,y] with pre-multiplied alpha blend.
function blend(pixels, size, x, y, r, g, b, a) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const i = (y * size + x) * 4;
  const fa = a / 255, ba = pixels[i + 3] / 255;
  const oa = fa + ba * (1 - fa);
  if (oa === 0) return;
  pixels[i]     = Math.round((r * fa + pixels[i]     * ba * (1 - fa)) / oa);
  pixels[i + 1] = Math.round((g * fa + pixels[i + 1] * ba * (1 - fa)) / oa);
  pixels[i + 2] = Math.round((b * fa + pixels[i + 2] * ba * (1 - fa)) / oa);
  pixels[i + 3] = Math.round(oa * 255);
}

// Anti-aliased rounded rectangle fill.
function fillRoundRect(pixels, size, x, y, w, h, rx, r, g, b) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      // distance from nearest corner circle centre
      const cx = px < x + rx ? x + rx : (px >= x + w - rx ? x + w - rx : px + 0.5);
      const cy = py < y + rx ? y + rx : (py >= y + h - rx ? y + h - rx : py + 0.5);
      const dx = (px + 0.5) - cx, dy = (py + 0.5) - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > rx + 0.5) continue;
      const alpha = dist > rx - 0.5 ? Math.round((rx + 0.5 - dist) * 255) : 255;
      blend(pixels, size, px, py, r, g, b, alpha);
    }
  }
}

function renderIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const s = size / 256; // scale factor relative to 256 px master

  const sc = (v) => Math.round(v * s);
  const sm = (v) => Math.max(1, sc(v));

  // ── Background ──────────────────────────────────────────────────────────────
  // #1e293b  slate-800
  fillRoundRect(pixels, size, 0, 0, size, size, sc(20), 30, 41, 59);

  // ── Bars ────────────────────────────────────────────────────────────────────
  // Each bar: [x, y, w, h, r, g, b]
  // Designed in 256×256 space:
  //  Bar 1 (indigo  #6366f1) — starts left, medium-long
  //  Bar 2 (green   #22c55e) — starts slightly right, longest
  //  Bar 3 (amber   #f59e0b) — starts left-ish, medium

  const barH   = sc(46);
  const barRad = sm(9);

  const bars = [
    { x: sc(28), y: sc(50),  w: sc(176), r: 99,  g: 102, b: 241 }, // indigo
    { x: sc(60), y: sc(112), w: sc(150), r: 34,  g: 197, b: 94  }, // green
    { x: sc(36), y: sc(174), w: sc(164), r: 245, g: 158, b: 11  }, // amber
  ];

  for (const { x, y, w, r, g, b } of bars) {
    fillRoundRect(pixels, size, x, y, w, barH, barRad, r, g, b);
  }

  return pixels;
}

// ── Generate and save ─────────────────────────────────────────────────────────
const ICO_SIZES = [16, 32, 48, 256];
const entries = ICO_SIZES.map(size => ({ size, png: encodePNG(size, renderIcon(size)) }));

const ico = buildICO(entries);
fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico);
console.log('✓ build/icon.ico  (' + Math.round(ico.length / 1024) + ' KB, sizes: ' + ICO_SIZES.join(', ') + ')');

// 1024×1024 PNG for macOS (high-resolution Dock icon; electron-builder auto-converts to .icns)
const png1024 = encodePNG(1024, renderIcon(1024));
fs.writeFileSync(path.join(BUILD, 'icon.png'), png1024);
console.log('✓ build/icon.png  (1024×1024)');

console.log('\nDone — rebuild with  npm run dist  to apply the new icon.');
