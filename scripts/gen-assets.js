// Generates tray + app icons as PNGs using only node's zlib. No binary assets to track.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- tiny SDF rasteriser (4x supersampled) ---
const SS = 4;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function roundRectDist(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function inTriangle(px, py, a, b, c) {
  const s = (a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0]);
  const t = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
  if (s < 0 !== t < 0 && s !== 0 && t !== 0) return false;
  const d = (c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0]);
  return d === 0 || d < 0 === s + t <= 0;
}

// shade(x, y) -> [r, g, b, a] with 0..255 components, sampled in a 0..size space
function render(size, shade) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const s = shade(px, py);
          r += s[0] * s[3]; g += s[1] * s[3]; b += s[2] * s[3]; a += s[3];
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      out[i] = a > 0 ? Math.round(r / a) : 0;
      out[i + 1] = a > 0 ? Math.round(g / a) : 0;
      out[i + 2] = a > 0 ? Math.round(b / a) : 0;
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

// Glyph: a monitor outline with a play triangle inside. u is a 0..1 coordinate pair.
function glyphAlpha(ux, uy) {
  const S = 100;
  const x = ux * S, y = uy * S;
  // monitor body outline
  const d = roundRectDist(x, y, 50, 44, 40, 29, 8);
  const stroke = clamp01(1 - (Math.abs(d) - 4.5) * 1.6);
  // stand
  const standBase = roundRectDist(x, y, 50, 82, 20, 3.5, 3.5) < 0 ? 1 : 0;
  const standNeck = roundRectDist(x, y, 50, 76, 7, 6, 2) < 0 ? 1 : 0;
  // play triangle
  const tri = inTriangle(x, y, [41, 30], [41, 58], [66, 44]) ? 1 : 0;
  return clamp01(Math.max(stroke, standBase, standNeck, tri));
}

function trayImage(size) {
  // macOS template image: pure black + alpha, the OS recolours it per theme.
  return render(size, (px, py) => [0, 0, 0, glyphAlpha(px / size, py / size)]);
}

function appIcon(size) {
  return render(size, (px, py) => {
    const u = px / size, v = py / size;
    // rounded-square background with a diagonal gradient
    const d = roundRectDist(px, py, size / 2, size / 2, size * 0.46, size * 0.46, size * 0.22);
    const bgA = clamp01(-d);
    const t = clamp01((u + v) / 2);
    const bg = [
      Math.round(88 + t * (168 - 88)),
      Math.round(101 + t * (85 - 101)),
      Math.round(242 + t * (247 - 242)),
    ];
    // glyph inset inside the tile
    const gx = (u - 0.5) / 0.62 + 0.5;
    const gy = (v - 0.5) / 0.62 + 0.5;
    const ga = gx < 0 || gx > 1 || gy < 0 || gy > 1 ? 0 : glyphAlpha(gx, gy);
    const r = Math.round(bg[0] * (1 - ga) + 255 * ga);
    const g = Math.round(bg[1] * (1 - ga) + 255 * ga);
    const b = Math.round(bg[2] * (1 - ga) + 255 * ga);
    return [r, g, b, bgA];
  });
}

const dir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(dir, { recursive: true });

const targets = [
  ['trayTemplate.png', encodePNG(22, 22, trayImage(22))],
  ['trayTemplate@2x.png', encodePNG(44, 44, trayImage(44))],
  ['icon.png', encodePNG(512, 512, appIcon(512))],
];
for (const [name, buf] of targets) {
  fs.writeFileSync(path.join(dir, name), buf);
  console.log('wrote assets/' + name, buf.length + 'B');
}
