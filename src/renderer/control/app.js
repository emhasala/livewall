'use strict';

let snap = null;
let selection = new Set(); // display keys
let dragDepth = 0;

const $ = (id) => document.getElementById(id);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// ---------- helpers ----------

function fmtDuration(sec) {
  if (!sec || !isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtBytes(b) {
  if (!b) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function mediaById(id) {
  return snap.library.find((m) => m.id === id) || null;
}

function selectedDisplays() {
  return snap.displays.filter((d) => selection.has(d.key));
}

function toast(message, kind) {
  const node = el('div', `toast${kind ? ' ' + kind : ''}`, message);
  $('toasts').append(node);
  setTimeout(() => {
    node.style.transition = 'opacity 200ms ease';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 220);
  }, 4200);
}

// ---------- rendering ----------

function render() {
  renderTitlebar();
  renderDisplays();
  renderLibrary();
  renderInspector();
}

function renderTitlebar() {
  const g = snap.global;
  const assigned = snap.global.spanMode
    ? (snap.global.span.mediaId ? snap.displays.filter((d) => d.config.enabled).length : 0)
    : snap.displays.filter((d) => d.config.mediaId && d.config.enabled).length;
  $('pauseBtn').textContent = snap.paused ? 'Resume' : 'Pause';
  $('muteBtn').textContent = g.muted ? 'Unmute' : 'Mute';
  $('statusLine').textContent = snap.paused
    ? (snap.autoPaused && !g.paused ? 'Paused automatically — on battery' : 'Paused')
    : `${assigned} of ${plural(snap.displays.length, 'display')} live`;
  document.querySelector('.brand .dot').classList.toggle('paused', snap.paused || !assigned);
}

// ---------- arrange canvas ----------
//
// Monitors are drawn to scale in one shared space, the way the OS display panel
// shows them. In span mode each one is painted with its own slice of the wallpaper,
// so the canvas is a live preview of how the image will be divided.

let arrangeCtx = null; // {world, scale, offX, offY} shared with the drag handler

function unionRect(rects) {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function spanMedia() {
  return snap.global.spanMode ? mediaById(snap.global.span.mediaId) : null;
}

function renderDisplays() {
  const host = $('arrange');
  host.textContent = '';
  updateModeSwitch();

  if (!snap.displays.length) {
    host.append(el('div', 'arrange-empty', 'No displays detected'));
    return;
  }

  const box = host.getBoundingClientRect();
  const cw = box.width || 720;
  const ch = box.height || 280;
  const pad = 28;
  const world = unionRect(snap.displays.map((d) => d.rect));
  const scale = Math.min((cw - pad * 2) / world.width, (ch - pad * 2) / world.height);
  arrangeCtx = {
    world,
    scale,
    offX: (cw - world.width * scale) / 2,
    offY: (ch - world.height * scale) / 2,
  };

  for (const d of snap.displays) {
    const node = el('div', 'mon');
    node.classList.toggle('selected', selection.has(d.key));
    node.classList.toggle('off', !d.config.enabled);
    if (d.primary) node.append(el('span', 'mon-primary', 'Primary'));

    const label = el('div', 'mon-label');
    label.append(el('b', null, d.label));
    label.append(document.createTextNode(' '));
    label.append(el('span', null, `${d.bounds.width}×${d.bounds.height}`));
    node.append(label);
    node.append(el('div', 'mon-blank', ''));

    placeMonitor(node, d);
    paintMonitor(node, d);

    node.addEventListener('pointerdown', (e) => beginDrag(e, d, node));
    host.append(node);
  }
}

function placeMonitor(node, d) {
  const { world, scale, offX, offY } = arrangeCtx;
  node.style.left = `${offX + (d.rect.x - world.x) * scale}px`;
  node.style.top = `${offY + (d.rect.y - world.y) * scale}px`;
  node.style.width = `${d.rect.width * scale}px`;
  node.style.height = `${d.rect.height * scale}px`;
}

// Draws either this display's own wallpaper (per-display mode) or its slice of the
// shared one (span mode). The slice maths mirrors what the wallpaper renderer does
// with the real video, so the preview and the desktop agree.
function paintMonitor(node, d) {
  const { world, scale } = arrangeCtx;
  const blank = node.querySelector('.mon-blank');
  const span = spanMedia();

  // The preview runs the exact same placement maths as the desktop, just expressed
  // in canvas pixels, so what you see here is what lands on the screens.
  if (span && span.thumbUrl && d.config.enabled) {
    const cfg = snap.global.span;
    const box = Layout.place(span.width || 16, span.height || 9, {
      sw: world.width * scale,
      sh: world.height * scale,
      dx: (d.rect.x - world.x) * scale,
      dy: (d.rect.y - world.y) * scale,
      dw: d.rect.width * scale,
      dh: d.rect.height * scale,
    }, { mode: cfg.fit, zoom: cfg.zoom, offsetX: cfg.offsetX, offsetY: cfg.offsetY });
    node.style.backgroundImage = `url("${span.thumbUrl}")`;
    node.style.backgroundSize = `${box.width}px ${box.height}px`;
    node.style.backgroundPosition = `${box.left}px ${box.top}px`;
    blank.textContent = '';
    return;
  }

  const own = snap.global.spanMode ? null : mediaById(d.config.mediaId);
  if (own && own.thumbUrl) {
    const box = Layout.place(own.width || 16, own.height || 9,
      { sw: d.rect.width * scale, sh: d.rect.height * scale },
      { mode: d.config.fit, zoom: d.config.zoom, offsetX: d.config.offsetX, offsetY: d.config.offsetY });
    node.style.backgroundImage = `url("${own.thumbUrl}")`;
    node.style.backgroundSize = `${box.width}px ${box.height}px`;
    node.style.backgroundPosition = `${box.left}px ${box.top}px`;
    blank.textContent = '';
  } else {
    node.style.backgroundImage = '';
    blank.textContent = snap.global.spanMode
      ? (d.config.enabled ? 'No wallpaper' : 'Excluded')
      : 'No wallpaper';
  }
}

// Drag to rearrange. Positions are held in display coordinates so the maths is
// independent of how the canvas happens to be scaled.
function beginDrag(e, d, node) {
  if (e.button !== 0) return;
  e.preventDefault();

  const ctx = arrangeCtx;
  const start = { px: e.clientX, py: e.clientY, x: d.rect.x, y: d.rect.y };
  let moved = false;
  node.setPointerCapture(e.pointerId);

  const others = snap.displays.filter((o) => o.key !== d.key).map((o) => o.rect);

  const onMove = (ev) => {
    const dxPx = ev.clientX - start.px;
    const dyPx = ev.clientY - start.py;
    if (!moved && Math.hypot(dxPx, dyPx) < 3) return; // let a click stay a click
    moved = true;
    node.classList.add('dragging');

    const want = {
      x: start.x + dxPx / ctx.scale,
      y: start.y + dyPx / ctx.scale,
      width: d.rect.width,
      height: d.rect.height,
    };
    const snapped = snapRect(want, others, 12 / ctx.scale);
    d.rect.x = Math.round(snapped.x);
    d.rect.y = Math.round(snapped.y);
    placeMonitor(node, d);
    paintMonitor(node, d);
  };

  const onUp = async () => {
    node.releasePointerCapture?.(e.pointerId);
    node.removeEventListener('pointermove', onMove);
    node.removeEventListener('pointerup', onUp);
    node.classList.remove('dragging');

    if (!moved) {
      const additive = e.metaKey || e.ctrlKey || e.shiftKey;
      if (additive) selection.has(d.key) ? selection.delete(d.key) : selection.add(d.key);
      else selection = new Set([d.key]);
      render();
      return;
    }
    const map = {};
    for (const disp of snap.displays) map[disp.key] = { x: disp.rect.x, y: disp.rect.y };
    snap = await window.api.setArrangement(map);
    render();
  };

  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
}

// Magnetic edges: butt a monitor against its neighbours, or line their edges up.
function snapRect(r, others, tol) {
  let x = r.x, y = r.y;
  let bestX = tol, bestY = tol;
  for (const o of others) {
    for (const cand of [o.x - r.width, o.x + o.width, o.x, o.x + o.width - r.width]) {
      const dist = Math.abs(cand - r.x);
      if (dist < bestX) { bestX = dist; x = cand; }
    }
    for (const cand of [o.y - r.height, o.y + o.height, o.y, o.y + o.height - r.height]) {
      const dist = Math.abs(cand - r.y);
      if (dist < bestY) { bestY = dist; y = cand; }
    }
  }
  return { x, y };
}

function updateModeSwitch() {
  const spanOn = snap.global.spanMode;
  for (const btn of $('modeSwitch').querySelectorAll('button')) {
    btn.classList.toggle('on', (btn.dataset.mode === 'span') === spanOn);
  }
  $('arrangeHint').textContent = spanOn
    ? 'One wallpaper divided across every display. Drag a monitor to match how your screens really sit — this changes how the image is sliced, not your system display arrangement.'
    : 'Click a display to select it, ⌘/Ctrl-click for several. Drag to rearrange.';
}

function renderLibrary() {
  const grid = $('libraryGrid');
  grid.textContent = '';

  if (!snap.library.length) {
    const empty = el('div', 'empty-state');
    empty.append(el('div', null, 'No wallpapers yet.'));
    empty.append(el('div', null, 'Drop in a video (MP4 or WebM) or an image (JPEG, PNG, GIF, WebP) — animated GIFs work as live wallpapers too.'));
    grid.append(empty);
    return;
  }

  const inUse = new Map();
  if (snap.global.spanMode) {
    if (snap.global.span.mediaId) inUse.set(snap.global.span.mediaId, snap.displays.filter((d) => d.config.enabled).length);
  } else {
    for (const d of snap.displays) {
      if (d.config.mediaId) inUse.set(d.config.mediaId, (inUse.get(d.config.mediaId) || 0) + 1);
    }
  }

  for (const m of snap.library) {
    const tile = el('div', 'tile');
    tile.classList.toggle('in-use', inUse.has(m.id));

    const thumb = el('div', 'thumb');
    if (m.thumbUrl) {
      const img = el('img');
      img.src = m.thumbUrl;
      thumb.append(img);
    } else {
      thumb.append(el('span', 'placeholder', 'Reading…'));
    }
    if (inUse.has(m.id)) {
      thumb.append(el('span', 'use-badge', `On ${plural(inUse.get(m.id), 'display')}`));
    }
    tile.append(thumb);
    if (m.undecodable) {
      const warn = el('span', 'warn err', "Can't play");
      warn.title = `This file failed to decode${m.error ? ': ' + m.error : ''}.\nConvert it to MP4 (H.264) or WebM.`;
      tile.append(warn);
    } else if (m.hint === 'container') {
      const warn = el('span', 'warn', 'May not decode');
      warn.title = 'MOV/MKV/OGV often use codecs Chromium cannot play. If it shows black, convert to MP4 (H.264) or WebM.';
      tile.append(warn);
    }

    const info = el('div', 'info');
    info.append(el('div', 'name', m.name));
    const bits = [m.kind === 'video' ? fmtDuration(m.duration)
      : /\.gif$/i.test(m.file) ? 'Animated GIF' : 'Image'];
    if (m.width) bits.push(`${m.width}×${m.height}`);
    if (m.bytes) bits.push(fmtBytes(m.bytes));
    info.append(el('div', 'meta', bits.join(' · ')));
    tile.append(info);

    const remove = el('button', 'remove', '×');
    remove.title = 'Remove from library';
    remove.addEventListener('click', async (e) => {
      e.stopPropagation();
      snap = await window.api.removeMedia(m.id);
      render();
    });
    tile.append(remove);

    tile.addEventListener('click', () => applyToSelection(m.id));
    tile.addEventListener('dblclick', () => renameMedia(m));
    grid.append(tile);
  }
}

async function applyToSelection(mediaId) {
  if (snap.global.spanMode) {
    snap = await window.api.setGlobal({ span: { mediaId } });
    render();
    return;
  }
  const targets = selection.size ? [...selection] : snap.displays.map((d) => d.key);
  if (!targets.length) return;
  snap = await window.api.setDisplay(targets, { mediaId, enabled: true });
  if (!selection.size && snap.displays.length > 1) toast('Applied to all displays');
  render();
}

async function renameMedia(m) {
  const name = prompt('Wallpaper name', m.name);
  if (name == null) return;
  snap = await window.api.renameMedia(m.id, name);
  render();
}

// ---------- inspector ----------

function renderInspector() {
  const box = $('inspector');
  box.textContent = '';
  const chosen = selectedDisplays();

  if (snap.global.spanMode) {
    box.append(el('h3', null, 'Spanned wallpaper'));
    box.append(spanControls());
    if (chosen.length) {
      box.append(el('h3', null, chosen.length === 1 ? chosen[0].label : `${chosen.length} displays`));
      box.append(inclusionControls(chosen));
    }
  } else {
    box.append(el('h3', null, chosen.length
      ? (chosen.length === 1 ? chosen[0].label : `${chosen.length} displays selected`)
      : 'Display'));

    if (!chosen.length) {
      const note = el('p', 'placeholder-note',
        'Select a display above to change how its wallpaper is fitted, how loud it is, and how bright it looks. Clicking a wallpaper with nothing selected applies it everywhere.');
      box.append(note);
    } else {
      box.append(displayControls(chosen));
    }
  }

  box.append(el('h3', null, 'Playback'));
  box.append(globalToggles());
  box.append(el('h3', null, 'Startup'));
  box.append(startupToggles());
}

// Multi-select shows the first display's value, and writing applies to all of them.
function displayControls(chosen) {
  const frag = document.createDocumentFragment();
  const cfg = chosen[0].config;
  const keys = chosen.map((d) => d.key);
  const media = mediaById(cfg.mediaId);
  // A still image has nothing to play, so speed and volume would be dead controls.
  const isVideo = !media || media.kind === 'video';
  const write = async (patch) => {
    snap = await window.api.setDisplay(keys, patch);
    render();
  };

  frag.append(toggleRow('Show wallpaper', 'Turn off to reveal the system wallpaper on this display',
    cfg.enabled, (v) => write({ enabled: v })));

  frag.append(segmentedField('Fit', cfg.fit, [
    ['cover', 'Fill'],
    ['contain', 'Fit'],
    ['blur', 'Blur'],
    ['stretch', 'Stretch'],
  ], (v) => write({ fit: v })));

  frag.append(cropControls(cfg, write));

  frag.append(sliderField('Brightness', cfg.brightness, 0.2, 1, 0.05,
    (v) => `${Math.round(v * 100)}%`, (v) => write({ brightness: v })));

  if (isVideo) {
    frag.append(sliderField('Speed', cfg.rate, 0.25, 2, 0.05,
      (v) => `${v.toFixed(2)}×`, (v) => write({ rate: v })));

    frag.append(sliderField('Volume', cfg.volume, 0, 1, 0.05,
      (v) => (v === 0 ? 'Silent' : `${Math.round(v * 100)}%`), (v) => write({ volume: v, muted: v === 0 })));
  }

  if (isVideo && snap.global.muted && cfg.volume > 0) {
    const note = el('p', 'placeholder-note', 'Everything is muted globally — unmute in the title bar to hear this.');
    note.style.fontSize = '11px';
    frag.append(note);
  }

  const clear = el('button', 'btn small ghost', 'Clear wallpaper');
  clear.style.marginTop = '6px';
  clear.addEventListener('click', () => write({ mediaId: null }));
  frag.append(clear);

  return frag;
}

// In span mode every monitor shows one image, so playback settings are shared;
// only "is this display part of the span" stays per-monitor.
function spanControls() {
  const frag = document.createDocumentFragment();
  const span = snap.global.span;
  const media = mediaById(span.mediaId);
  const write = async (patch) => {
    snap = await window.api.setGlobal({ span: patch });
    render();
  };

  const shown = snap.displays.filter((d) => d.config.enabled).length;
  const note = el('p', 'placeholder-note', media
    ? `Showing “${media.name}” across ${plural(shown, 'display')}.`
    : 'Pick a wallpaper below to stretch it across every display.');
  note.style.marginBottom = '12px';
  frag.append(note);

  if (snap.span) {
    const dims = el('p', 'placeholder-note', `Combined canvas: ${snap.span.width}×${snap.span.height}`);
    dims.style.cssText = 'font-size:11px;margin-bottom:12px';
    frag.append(dims);
    if (media && media.width && media.width < snap.span.width * 0.75) {
      const warn = el('p', 'placeholder-note',
        `This clip is only ${media.width}px wide, so it will be upscaled to cover the span and may look soft.`);
      warn.style.cssText = 'font-size:11px;color:#d99a2b;margin-bottom:12px';
      frag.append(warn);
    }
  }

  frag.append(segmentedField('Fit', span.fit, [
    ['cover', 'Fill'],
    ['contain', 'Fit'],
    ['blur', 'Blur'],
    ['stretch', 'Stretch'],
  ], (v) => write({ fit: v })));

  frag.append(cropControls(span, write));

  frag.append(sliderField('Brightness', span.brightness, 0.2, 1, 0.05,
    (v) => `${Math.round(v * 100)}%`, (v) => write({ brightness: v })));
  if (!media || media.kind === 'video') {
    frag.append(sliderField('Speed', span.rate, 0.25, 2, 0.05,
      (v) => `${v.toFixed(2)}×`, (v) => write({ rate: v })));
    frag.append(sliderField('Volume', span.volume, 0, 1, 0.05,
      (v) => (v === 0 ? 'Silent' : `${Math.round(v * 100)}%`), (v) => write({ volume: v, muted: v === 0 })));
  }

  const clear = el('button', 'btn small ghost', 'Clear wallpaper');
  clear.addEventListener('click', () => write({ mediaId: null }));
  frag.append(clear);
  return frag;
}

// Zoom and pan. Pan is a fraction of whatever is currently cropped off, so the
// sliders do nothing while the image already fits exactly — which is why they're
// disabled rather than silently inert in that case.
function cropControls(cfg, write) {
  const frag = document.createDocumentFragment();
  const zoom = cfg.zoom == null ? 1 : cfg.zoom;

  frag.append(sliderField('Zoom', zoom, 1, 4, 0.05,
    (v) => `${v.toFixed(2)}×`, (v) => write({ zoom: v })));

  const canPan = zoom > 1.001 || cfg.fit === 'cover';
  const px = sliderField('Horizontal', cfg.offsetX || 0, -1, 1, 0.02,
    (v) => (v === 0 ? 'Centre' : `${v > 0 ? 'Right' : 'Left'} ${Math.round(Math.abs(v) * 100)}%`),
    (v) => write({ offsetX: v }));
  const py = sliderField('Vertical', cfg.offsetY || 0, -1, 1, 0.02,
    (v) => (v === 0 ? 'Centre' : `${v > 0 ? 'Down' : 'Up'} ${Math.round(Math.abs(v) * 100)}%`),
    (v) => write({ offsetY: v }));
  if (!canPan) {
    for (const f of [px, py]) {
      f.querySelector('input').disabled = true;
      f.style.opacity = '0.45';
      f.title = 'Zoom in, or use Fill, to have something to pan across';
    }
  }
  frag.append(px, py);

  const reset = el('button', 'btn small ghost', 'Reset crop');
  reset.style.marginBottom = '4px';
  reset.addEventListener('click', () => write({ zoom: 1, offsetX: 0, offsetY: 0 }));
  frag.append(reset);
  return frag;
}

function inclusionControls(chosen) {
  const frag = document.createDocumentFragment();
  const keys = chosen.map((d) => d.key);
  frag.append(toggleRow('Include in span',
    'Excluded displays drop out of the layout and show the system wallpaper',
    chosen[0].config.enabled,
    async (v) => { snap = await window.api.setDisplay(keys, { enabled: v }); render(); }));
  return frag;
}

function globalToggles() {
  const frag = document.createDocumentFragment();
  const g = snap.global;
  const write = async (patch) => {
    snap = await window.api.setGlobal(patch);
    render();
  };

  frag.append(toggleRow('Cover the full screen',
    snap.platform === 'darwin'
      ? 'Off: stop below the menu bar and above the Dock'
      : 'Off: stop above the taskbar',
    !snap.global.useWorkArea, (v) => write({ useWorkArea: !v })));
  frag.append(toggleRow('Sync across displays',
    'Monitors showing the same clip stay frame-aligned', g.syncPlayback, (v) => write({ syncPlayback: v })));
  frag.append(toggleRow('Pause on battery',
    'Stops decoding when the charger is unplugged', g.pauseOnBattery, (v) => write({ pauseOnBattery: v })));

  const fullscreenSupported = snap.platform === 'win32';
  const row = toggleRow('Pause for fullscreen apps',
    fullscreenSupported
      ? 'Stops while a game or video covers a display'
      : 'Windows only — macOS already throttles occluded desktop windows',
    g.pauseOnFullscreen && fullscreenSupported,
    (v) => write({ pauseOnFullscreen: v }));
  if (!fullscreenSupported) {
    row.querySelector('.switch').disabled = true;
    row.style.opacity = '0.55';
  }
  frag.append(row);
  return frag;
}

function startupToggles() {
  const frag = document.createDocumentFragment();
  frag.append(toggleRow('Launch at login', 'Restore wallpapers when you sign in',
    snap.global.launchAtLogin, async (v) => {
      snap = await window.api.setGlobal({ launchAtLogin: v });
      render();
    }));

  const quit = el('button', 'btn small danger', 'Quit LiveWall');
  quit.style.marginTop = '14px';
  quit.addEventListener('click', () => window.api.quit());
  frag.append(quit);
  return frag;
}

// ---------- small control factories ----------

function toggleRow(title, subtitle, value, onChange) {
  const row = el('div', 'toggle');
  const label = el('div', 'label');
  label.append(document.createTextNode(title));
  if (subtitle) label.append(el('small', null, subtitle));
  const sw = el('button', `switch${value ? ' on' : ''}`);
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(!!value));
  sw.setAttribute('aria-label', title);
  sw.addEventListener('click', () => onChange(!value));
  row.append(label, sw);
  return row;
}

function segmentedField(title, value, options, onChange) {
  const field = el('div', 'field');
  const label = el('label');
  label.append(document.createTextNode(title));
  field.append(label);
  const seg = el('div', 'segmented');
  for (const [key, text] of options) {
    const b = el('button', key === value ? 'on' : '', text);
    b.addEventListener('click', () => onChange(key));
    seg.append(b);
  }
  field.append(seg);
  return field;
}

function sliderField(title, value, min, max, step, format, onChange) {
  const field = el('div', 'field');
  const label = el('label');
  label.append(document.createTextNode(title));
  const readout = el('span', 'value', format(value));
  label.append(readout);

  const input = el('input');
  input.type = 'range';
  input.min = min; input.max = max; input.step = step; input.value = value;
  // Update the readout continuously but only persist on release, so dragging a
  // slider doesn't write config (and re-render) on every pixel of movement.
  input.addEventListener('input', () => { readout.textContent = format(Number(input.value)); });
  input.addEventListener('change', () => onChange(Number(input.value)));

  field.append(label, input);
  return field;
}

// ---------- media probing ----------

// Main can't read video metadata without shipping ffmpeg, so the control window
// does it: load each new clip off-screen, record its dimensions, and grab a frame
// a little way in (the very first frame is often black on fades).
async function probe(item) {
  if (item.kind === 'image') return probeImage(item);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.src = item.src;

    const fail = () => resolve(null);
    video.addEventListener('error', fail);

    video.addEventListener('loadedmetadata', () => {
      const seekTo = Math.min(1, (video.duration || 2) * 0.25);
      const capture = () => {
        const canvas = document.createElement('canvas');
        const w = 480;
        canvas.width = w;
        canvas.height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w)) || 270;
        try {
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve({
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
            thumb: canvas.toDataURL('image/jpeg', 0.82),
          });
        } catch {
          resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
        }
      };
      video.addEventListener('seeked', capture, { once: true });
      video.currentTime = seekTo;
    });

    setTimeout(fail, 12000);
  });
}

function probeImage(item) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = { duration: 0, width: img.naturalWidth, height: img.naturalHeight };
      try {
        const canvas = document.createElement('canvas');
        const w = 480;
        canvas.width = w;
        canvas.height = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ ...size, thumb: canvas.toDataURL('image/jpeg', 0.82) });
      } catch {
        // A tainted canvas throws on export. The wallpaper still works, so keep
        // the dimensions and go without a thumbnail rather than stalling the queue.
        resolve(size);
      }
    };
    img.onerror = () => resolve(null);
    img.src = item.src;
  });
}

async function probePending() {
  const pending = snap.library.filter((m) => !m.thumb);
  for (const item of pending) {
    const meta = await probe(item);
    if (!meta) {
      toast(`Couldn't read “${item.name}”. Convert it to MP4 (H.264) or WebM.`, 'warn');
      continue;
    }
    snap = await window.api.saveMeta({ id: item.id, ...meta });
    render();
  }
}

async function handleImport(result) {
  for (const skip of result.skipped || []) toast(skip.reason, 'warn');
  if (result.added && result.added.length) {
    snap = await window.api.snapshot();
    render();
    await probePending();
  }
}

// ---------- wiring ----------

$('pauseBtn').addEventListener('click', async () => {
  // Always toggles the user's own pause; an automatic pause clears itself.
  snap = await window.api.setGlobal({ paused: !snap.paused });
  render();
});
$('muteBtn').addEventListener('click', async () => {
  snap = await window.api.setGlobal({ muted: !snap.global.muted });
  render();
});
$('identifyBtn').addEventListener('click', () => window.api.identifyDisplays());

for (const btn of $('modeSwitch').querySelectorAll('button')) {
  btn.addEventListener('click', async () => {
    const spanMode = btn.dataset.mode === 'span';
    if (spanMode === snap.global.spanMode) return;
    const patch = { spanMode };
    // Turning span on with nothing chosen yet: carry over whatever is already on
    // a display rather than dumping the user on an empty desktop.
    if (spanMode && !snap.global.span.mediaId) {
      const inherited = snap.displays.find((d) => d.config.mediaId);
      if (inherited) patch.span = { mediaId: inherited.config.mediaId };
    }
    snap = await window.api.setGlobal(patch);
    render();
  });
}

$('resetLayoutBtn').addEventListener('click', async () => {
  snap = await window.api.setArrangement({});
  toast('Layout reset to your system display arrangement');
  render();
});

// The canvas is laid out in pixels, so it has to be rebuilt when the window resizes.
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (snap) renderDisplays(); }, 120);
});
$('addBtn').addEventListener('click', async () => handleImport(await window.api.pickMedia()));
$('folderBtn').addEventListener('click', () => window.api.openMediaFolder());

// Drag & drop, counted so moving over child elements doesn't flicker the overlay.
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  $('dropzone').classList.add('active');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  if (--dragDepth <= 0) { dragDepth = 0; $('dropzone').classList.remove('active'); }
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('dropzone').classList.remove('active');
  const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean);
  if (paths.length) handleImport(await window.api.importMedia(paths));
});

window.api.onChanged((next) => {
  // Tell the user once when a file turns out to be undecodable — the wallpaper
  // renderer only finds out when it tries to play it, well after import.
  const wasBroken = new Set((snap ? snap.library : []).filter((m) => m.undecodable).map((m) => m.id));
  for (const m of next.library) {
    if (m.undecodable && !wasBroken.has(m.id)) {
      toast(`“${m.name}” can't be played — convert it to MP4 (H.264) or WebM.`, 'warn');
    }
  }
  snap = next;
  // Drop selections for monitors that were unplugged while we were looking away.
  const live = new Set(snap.displays.map((d) => d.key));
  for (const key of [...selection]) if (!live.has(key)) selection.delete(key);
  render();
});

(async function init() {
  snap = await window.api.snapshot();
  if (snap.displays.length === 1) selection.add(snap.displays[0].key);
  render();
  await probePending();
})();
