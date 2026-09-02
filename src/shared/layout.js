// Wallpaper placement maths — the single source of truth for where a source image
// or video sits inside a display.
//
// Used by the wallpaper renderer (positions the real element), the arrange-canvas
// preview (positions a background-image), and the tests. If these ever disagreed,
// the preview would lie about what lands on the desktop.
//
// One model covers both layouts: a `view` describes the canvas being filled and
// this screen's window onto it. For a per-display wallpaper the view IS the display.
// For a spanned wallpaper the view is the whole multi-monitor bounding box and
// (dx, dy) is where this display sits inside it.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Layout = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const MODES = ['cover', 'contain', 'blur', 'stretch'];
  const MAX_ZOOM = 5;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function baseSize(nw, nh, sw, sh, mode) {
    if (mode === 'stretch') return { rw: sw, rh: sh };
    // "blur" is "contain" with a blurred backdrop filling the letterbox.
    const scale = mode === 'contain' || mode === 'blur'
      ? Math.min(sw / nw, sh / nh)
      : Math.max(sw / nw, sh / nh);
    return { rw: nw * scale, rh: nh * scale };
  }

  function normalise(view) {
    return {
      sw: view.sw,
      sh: view.sh,
      dx: view.dx || 0,
      dy: view.dy || 0,
      dw: view.dw == null ? view.sw : view.dw,
      dh: view.dh == null ? view.sh : view.dh,
    };
  }

  // Where to put a source of nw x nh. Returns CSS-ready pixels relative to this
  // display's own viewport, so it drops straight into style.left/top/width/height.
  function place(nw, nh, view, opts) {
    const o = opts || {};
    const v = normalise(view);
    const mode = MODES.indexOf(o.mode) >= 0 ? o.mode : 'cover';
    const zoom = clamp(o.zoom == null ? 1 : o.zoom, 1, MAX_ZOOM);

    const base = baseSize(nw, nh, v.sw, v.sh, mode);
    const rw = base.rw * zoom;
    const rh = base.rh * zoom;

    // Pan is a fraction of the hidden overflow rather than raw pixels: -1 and 1 are
    // exactly the extremes of what can be revealed, so the control can never push
    // the image off its own screen, whatever the source's aspect ratio.
    const overflowX = Math.max(0, rw - v.sw);
    const overflowY = Math.max(0, rh - v.sh);
    // Positive offsets pan TOWARD the right/bottom of the source, which is what a
    // left-to-right slider should do.
    const left = (v.sw - rw) / 2 - clamp(o.offsetX || 0, -1, 1) * overflowX / 2;
    const top = (v.sh - rh) / 2 - clamp(o.offsetY || 0, -1, 1) * overflowY / 2;

    return { width: rw, height: rh, left: left - v.dx, top: top - v.dy };
  }

  // The rectangle of the ORIGINAL source visible on this display, in source pixels.
  // Tests use it to prove neighbouring monitors show adjacent, non-overlapping crops.
  function visibleSource(nw, nh, view, opts) {
    const v = normalise(view);
    const box = place(nw, nh, view, opts);
    const scaleX = box.width / nw;
    const scaleY = box.height / nh;
    return {
      x: -box.left / scaleX,
      y: -box.top / scaleY,
      width: v.dw / scaleX,
      height: v.dh / scaleY,
    };
  }

  // True when the source doesn't reach the edges, so the page should paint a
  // blurred backdrop behind it instead of leaving bars.
  function letterboxed(nw, nh, view, opts) {
    const v = normalise(view);
    const box = place(nw, nh, view, opts);
    return box.width < v.sw - 0.5 || box.height < v.sh - 0.5;
  }

  return { place, visibleSource, letterboxed, MODES, MAX_ZOOM };
});
