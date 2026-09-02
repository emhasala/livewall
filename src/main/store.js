const fs = require('fs');
const path = require('path');

// Required lazily: the geometry tests import this module and never touch a path,
// so they shouldn't need Electron present at all.
let electronApp = null;
function app() {
  if (!electronApp) electronApp = require('electron').app;
  return electronApp;
}

const DEFAULTS = {
  version: 1,
  global: {
    paused: false,
    muted: true,
    syncPlayback: true,
    pauseOnBattery: true,
    pauseOnFullscreen: true,
    launchAtLogin: false,
    // One wallpaper stretched across every display, sliced per monitor.
    spanMode: false,
    span: { mediaId: null, rate: 1, brightness: 1, volume: 0, muted: true,
            fit: 'cover', zoom: 1, offsetX: 0, offsetY: 0 },
    // Cover the whole panel, or stop at the work area so the menu bar and Dock
    // sit over the system background instead of the wallpaper.
    useWorkArea: false,
    // Optional per-display position override, keyed by displayKey. Absent means
    // "use the layout the OS reports".
    arrangement: {},
  },
  // keyed by displayKey() -> per-monitor assignment
  displays: {},
  library: [],
};

const DISPLAY_DEFAULTS = {
  mediaId: null,
  enabled: true,
  fit: 'cover',        // cover | contain | blur | stretch
  zoom: 1,             // 1..5, on top of the fit
  offsetX: 0,          // -1..1, fraction of the hidden overflow
  offsetY: 0,
  volume: 0,
  muted: true,
  rate: 1,
  brightness: 1,
};

class Store {
  constructor() {
    this.data = null;
  }

  get dir() {
    return app().getPath('userData');
  }

  get file() {
    return path.join(this.dir, 'config.json');
  }

  get mediaDir() {
    return path.join(this.dir, 'media');
  }

  get thumbDir() {
    return path.join(this.dir, 'thumbs');
  }

  load() {
    this.firstRun = !fs.existsSync(this.file);
    fs.mkdirSync(this.mediaDir, { recursive: true });
    fs.mkdirSync(this.thumbDir, { recursive: true });
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = {
        ...DEFAULTS,
        ...raw,
        global: {
          ...DEFAULTS.global,
          ...(raw.global || {}),
          span: { ...DEFAULTS.global.span, ...((raw.global || {}).span || {}) },
          arrangement: (raw.global || {}).arrangement || {},
        },
        displays: raw.displays || {},
        library: Array.isArray(raw.library) ? raw.library : [],
      };
    } catch {
      this.data = structuredClone(DEFAULTS);
    }
    // Drop library entries whose file vanished (user cleared the folder, moved a profile, ...)
    this.data.library = this.data.library.filter((m) => fs.existsSync(path.join(this.mediaDir, m.file)));
    const ids = new Set(this.data.library.map((m) => m.id));
    for (const cfg of Object.values(this.data.displays)) {
      if (cfg.mediaId && !ids.has(cfg.mediaId)) cfg.mediaId = null;
    }
    if (this.data.global.span.mediaId && !ids.has(this.data.global.span.mediaId)) {
      this.data.global.span.mediaId = null;
    }
    return this.data;
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  displayConfig(key) {
    if (!this.data.displays[key]) this.data.displays[key] = { ...DISPLAY_DEFAULTS };
    return { ...DISPLAY_DEFAULTS, ...this.data.displays[key] };
  }

  setGlobal(patch) {
    // `span` is merged rather than replaced so callers can send partial updates.
    const { span, ...rest } = patch;
    Object.assign(this.data.global, rest);
    if (span) Object.assign(this.data.global.span, span);
    this.save();
  }

  setArrangement(map) {
    this.data.global.arrangement = map || {};
    this.save();
  }

  setDisplay(keys, patch) {
    for (const key of [].concat(keys)) {
      this.data.displays[key] = { ...this.displayConfig(key), ...patch };
    }
    this.save();
  }

  addMedia(item) {
    this.data.library.unshift(item);
    this.save();
  }

  updateMedia(id, patch) {
    const item = this.data.library.find((m) => m.id === id);
    if (item) Object.assign(item, patch);
    this.save();
    return item;
  }

  removeMedia(id) {
    const item = this.data.library.find((m) => m.id === id);
    this.data.library = this.data.library.filter((m) => m.id !== id);
    for (const cfg of Object.values(this.data.displays)) {
      if (cfg.mediaId === id) cfg.mediaId = null;
    }
    if (this.data.global.span.mediaId === id) this.data.global.span.mediaId = null;
    this.save();
    return item;
  }

  mediaById(id) {
    return this.data.library.find((m) => m.id === id) || null;
  }
}

module.exports = { store: new Store(), DISPLAY_DEFAULTS };
