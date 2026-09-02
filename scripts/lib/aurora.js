// Shared frame/palette generator for the sample wallpaper.
const W = 400, H = 225, FRAMES = 32;

const stops = [
  [0.00, [10, 12, 30]],
  [0.35, [46, 39, 122]],
  [0.60, [109, 124, 242]],
  [0.80, [168, 85, 247]],
  [1.00, [110, 231, 220]],
];

function palette() {
  const out = [];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0], b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; break; }
    }
    const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
    out.push(
      Math.round(a[1][0] + (b[1][0] - a[1][0]) * f),
      Math.round(a[1][1] + (b[1][1] - a[1][1]) * f),
      Math.round(a[1][2] + (b[1][2] - a[1][2]) * f)
    );
  }
  return out;
}

function frame(n) {
  const px = new Uint8Array(W * H);
  const phase = (n / FRAMES) * Math.PI * 2; // whole periods => seamless loop
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const a = Math.sin(u * 6.0 + phase);
      const b = Math.sin(v * 4.0 - phase);
      const c = Math.sin((u + v) * 5.0 + phase * 2.0);
      const d = Math.sin(Math.hypot(u - 0.5, v - 0.55) * 9.0 - phase * 2.0);
      let t = (a + b + c + d) / 4;
      t = (t + 1) / 2;
      t = t * 0.78 + (1 - v) * 0.22;
      px[y * W + x] = Math.max(0, Math.min(255, Math.round(t * 255)));
    }
  }
  return px;
}

module.exports = { W, H, FRAMES, palette, frame };
