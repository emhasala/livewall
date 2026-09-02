// Geometry for wallpapers, spanned or not.
//
// Each monitor sits somewhere in one shared coordinate space. By default that's the
// layout the OS reports, but the user can drag monitors around in the app to
// override it — useful when the OS layout doesn't match how the screens actually sit
// on the desk, or when you want the image divided differently. Overriding here only
// changes how the wallpaper is sliced; it never touches the real display
// arrangement, which is the OS's to own.
const { store } = require('./store');

// The area of a display a wallpaper is allowed to cover: the whole panel, or just
// the work area (below the menu bar, above the Dock) when the user would rather
// leave those uncovered.
function displayRect(display) {
  const area = store.data.global.useWorkArea && display.workArea
    ? display.workArea
    : display.bounds;
  return { x: area.x, y: area.y, width: area.width, height: area.height };
}

function rectFor(display) {
  const base = displayRect(display);
  const override = store.data.global.arrangement[display.key];
  if (!override) return base;
  return { x: Math.round(override.x), y: Math.round(override.y), width: base.width, height: base.height };
}

// Bounding box of every display taking part in the span.
function spanRect(displays) {
  const rects = displays.map(rectFor);
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// The `view` this display presents onto the shared canvas: the canvas size, plus
// where this screen's window onto it begins. Feeds straight into shared/layout.js.
function sliceFor(display, span) {
  const r = rectFor(display);
  return {
    sw: span.width,
    sh: span.height,
    dx: r.x - span.x,
    dy: r.y - span.y,
    dw: r.width,
    dh: r.height,
  };
}

// The equivalent view for a wallpaper that covers only this one display.
function soloView(display) {
  const r = rectFor(display);
  return { sw: r.width, sh: r.height, dx: 0, dy: 0, dw: r.width, dh: r.height };
}

module.exports = { displayRect, rectFor, spanRect, sliceFor, soloView };
