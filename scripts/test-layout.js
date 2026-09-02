// Placement tests. These cover the failure that is hardest to eyeball: slices that
// overlap or leave a seam, so a spanned image doesn't line up across the bezels.
const assert = require('assert');
const Layout = require('../src/shared/layout.js');

const storeModule = require('../src/main/store.js');
storeModule.store.data = { global: { arrangement: {}, useWorkArea: false } };
const arrange = require('../src/main/arrange.js');

const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

function displaysOf(list) {
  return list.map((d) => ({
    key: d.key,
    bounds: { x: d.x, y: d.y, width: d.w, height: d.h },
    workArea: { x: d.x, y: d.y + 30, width: d.w, height: d.h - 30 },
  }));
}

function checkSpan(name, list, source, opts = {}, arrangement = {}) {
  storeModule.store.data.global.arrangement = arrangement;
  const displays = displaysOf(list);
  const span = arrange.spanRect(displays);
  const rects = displays.map(arrange.rectFor);
  const views = displays.map((d) => arrange.sliceFor(d, span));
  const crops = views.map((v) => Layout.visibleSource(source.w, source.h, v, opts));

  crops.forEach((c, i) => {
    assert.ok(c.x >= -0.01 && c.y >= -0.01, `${name}: ${list[i].key} crop starts outside source`);
    assert.ok(c.x + c.width <= source.w + 0.01, `${name}: ${list[i].key} overruns source width`);
    assert.ok(c.y + c.height <= source.h + 0.01, `${name}: ${list[i].key} overruns source height`);
    near(c.width / c.height, rects[i].width / rects[i].height, 1e-6,
      `${name}: ${list[i].key} aspect distorted`);
  });

  for (let i = 0; i < rects.length; i++) {
    for (let j = 0; j < rects.length; j++) {
      if (i === j) continue;
      const touching = Math.abs(rects[i].x + rects[i].width - rects[j].x) < 0.5;
      const overlapY = Math.min(rects[i].y + rects[i].height, rects[j].y + rects[j].height)
                     - Math.max(rects[i].y, rects[j].y);
      if (touching && overlapY > 0) {
        near(crops[i].x + crops[i].width, crops[j].x, 0.01,
          `${name}: seam between ${list[i].key} and ${list[j].key}`);
      }
    }
  }
  console.log(`  ok  ${name} — span ${span.width}x${span.height}`);
  return { span, crops };
}

const real = [
  { key: 'qhd', x: 0, y: 0, w: 2560, h: 1440 },
  { key: 'builtin', x: 2560, y: 0, w: 1680, h: 1050 },
  { key: 'portrait', x: 4240, y: 0, w: 1080, h: 1920 },
];

checkSpan('side-by-side 3x', real, { w: 3840, h: 2160 });
checkSpan('wide source', real, { w: 7680, h: 2160 });
checkSpan('tall source', real, { w: 1920, h: 3000 });
checkSpan('negative origin', [
  { key: 'left', x: -1920, y: -200, w: 1920, h: 1080 },
  { key: 'main', x: 0, y: 0, w: 2560, h: 1440 },
], { w: 5000, h: 1500 });

// Zoom and pan must keep the seam intact — that's the whole point of doing the
// maths once and sharing it.
checkSpan('spanned + zoom 2', real, { w: 3840, h: 2160 }, { zoom: 2 });
checkSpan('spanned + zoom 1.5, panned', real, { w: 3840, h: 2160 }, { zoom: 1.5, offsetX: 0.6, offsetY: -0.4 });

const stacked = checkSpan('user arrangement (stacked)', real, { w: 3840, h: 2160 }, {}, {
  qhd: { x: 0, y: 0 }, builtin: { x: 0, y: 1440 }, portrait: { x: 2560, y: 0 },
});
assert.strictEqual(stacked.span.width, 3640, 'stacked span width');
assert.strictEqual(stacked.span.height, 2490, 'stacked span height');

const exact = checkSpan('source matches span exactly', [
  { key: 'a', x: 0, y: 0, w: 1920, h: 1080 },
  { key: 'b', x: 1920, y: 0, w: 1920, h: 1080 },
], { w: 3840, h: 1080 });
near(exact.crops[0].x, 0, 1e-6, 'exact: left crop starts at 0');
near(exact.crops[1].x, 1920, 1e-6, 'exact: right crop starts at midpoint');

// --- single-display placement ---
const view = { sw: 2560, sh: 1440 };

let box = Layout.place(1920, 1080, view, { mode: 'cover' });
near(box.width, 2560, 1e-6, 'cover fills width');
near(box.height, 1440, 1e-6, 'cover fills height');

// A 16:9 source in a 16:9 view has no letterbox to test with, so use the portrait
// monitor — the case that actually matters on a mixed-orientation desk.
const portraitView = { sw: 1080, sh: 1920 };
box = Layout.place(1920, 1080, portraitView, { mode: 'contain' });
assert.ok(box.width <= 1080.01 && box.height <= 1920.01, 'contain stays inside');
assert.ok(Layout.letterboxed(1920, 1080, portraitView, { mode: 'contain' }), 'contain is letterboxed');
assert.ok(!Layout.letterboxed(1920, 1080, portraitView, { mode: 'cover' }), 'cover is not letterboxed');
near(Layout.place(1920, 1080, view, { mode: 'contain' }).width, 2560, 1e-6,
  'contain equals cover when aspects match');

box = Layout.place(1000, 1000, view, { mode: 'stretch' });
near(box.width, 2560, 1e-6, 'stretch fills width');
near(box.height, 1440, 1e-6, 'stretch fills height');

// Pan clamps: the image can never be dragged off its own screen.
for (const off of [-1, -0.5, 0, 0.5, 1, 5, -5]) {
  const b = Layout.place(1920, 1080, view, { mode: 'cover', zoom: 2, offsetX: off, offsetY: off });
  assert.ok(b.left <= 0.01, `pan ${off}: left edge leaves a gap`);
  assert.ok(b.top <= 0.01, `pan ${off}: top edge leaves a gap`);
  assert.ok(b.left + b.width >= view.sw - 0.01, `pan ${off}: right edge leaves a gap`);
  assert.ok(b.top + b.height >= view.sh - 0.01, `pan ${off}: bottom edge leaves a gap`);
}
console.log('  ok  pan clamped to the visible overflow at every offset');

// Positive pan moves toward the right/bottom of the source.
const centre = Layout.visibleSource(1920, 1080, view, { mode: 'cover', zoom: 2 });
const right = Layout.visibleSource(1920, 1080, view, { mode: 'cover', zoom: 2, offsetX: 1 });
assert.ok(right.x > centre.x, 'positive offsetX pans toward the right of the source');
console.log('  ok  pan direction');

// Zoom is clamped so the UI can't produce a degenerate placement.
const wild = Layout.place(1920, 1080, view, { mode: 'cover', zoom: 99 });
near(wild.width, 2560 * Layout.MAX_ZOOM, 1e-6, 'zoom clamped to MAX_ZOOM');
console.log('  ok  zoom clamped');

console.log('layout: all passed');
