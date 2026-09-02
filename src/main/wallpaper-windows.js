const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { store } = require('./store');
const { displayKey, describe } = require('./displays');
const { mediaUrl, thumbUrl } = require('./protocol');
const platform = require('./platform');
const { spanRect, sliceFor, soloView, displayRect } = require('./arrange');
const { SyncClock } = require('./sync');

const PAGE = path.join(__dirname, '..', 'renderer', 'wallpaper', 'index.html');
const PRELOAD = path.join(__dirname, '..', 'preload', 'wallpaper.js');

class WallpaperWindows {
  constructor() {
    this.windows = new Map(); // displayKey -> BrowserWindow
    this.span = null;          // bounding box of the spanned layout, when active
    this.pausedAt = null;
    // Effective pause: the user's stored choice OR an automatic one. Main owns the
    // distinction; we only ever see the result.
    this.paused = false;
    this.guard = null;         // keeps the windows pinned behind the icons
    this.sync = new SyncClock(() => this.pushSync());
  }

  // --- lifecycle -----------------------------------------------------------

  reconcile() {
    const displays = screen.getAllDisplays().map(describe);
    const live = new Set();

    const g = store.data.global;
    const spanning = g.spanMode && !!store.mediaById(g.span.mediaId);
    // In span mode the bounding box is computed over the displays taking part,
    // so a monitor excluded via its "show wallpaper" toggle also drops out of
    // the geometry instead of leaving a hole in the image.
    const taking = displays.filter((d) => store.displayConfig(d.key).enabled);
    this.span = spanning ? spanRect(taking) : null;

    for (const display of displays) {
      const cfg = store.displayConfig(display.key);
      const wants = spanning
        ? cfg.enabled
        : cfg.enabled && !!cfg.mediaId && !!store.mediaById(cfg.mediaId);
      if (!wants) continue;
      live.add(display.key);

      let win = this.windows.get(display.key);
      if (win && !win.isDestroyed()) {
        this.fit(win, display);
      } else {
        win = this.create(display);
        this.windows.set(display.key, win);
      }
    }

    // Monitors that were unplugged, disabled, or had their wallpaper cleared.
    for (const [key, win] of [...this.windows]) {
      if (live.has(key)) continue;
      this.windows.delete(key);
      if (!win.isDestroyed()) win.destroy();
    }

    this.pushAll();
    if (this.windows.size) this.startGuard();
    else this.stopGuard();
    if (this.windows.size && !this.paused) this.sync.start();
    else this.sync.stop();
  }

  create(display) {
    const area = displayRect(display);
    const win = new BrowserWindow({
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      // The one line that makes this a wallpaper instead of a window, on macOS.
      type: process.platform === 'darwin' ? 'desktop' : undefined,
      frame: false,
      show: false,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      // macOS rounds the corners of frameless windows by default. A wallpaper has
      // to be a hard rectangle or the desktop shows through at the corners.
      roundedCorners: false,
      thickFrame: false,
      backgroundColor: '#000000',
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });

    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.error(`[wallpaper ${display.label}] ${message}`);
      else if (process.env.LIVEWALL_DEBUG) console.log(`[wallpaper ${display.label}] ${message}`);
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error(`[wallpaper ${display.label}] renderer gone:`, details.reason);
    });

    win.loadFile(PAGE);
    win.once('ready-to-show', () => {
      win.showInactive();
      platform.attach(win, display);
      this.fit(win, display);
      this.push(display.key);
    });
    win.webContents.on('did-finish-load', () => this.push(display.key));
    return win;
  }

  fit(win, display) {
    if (win.isDestroyed()) return;
    win.setBounds(displayRect(display));
    // Re-parenting is cheap and Explorer sometimes drops children when the desktop
    // is rebuilt (resolution change, Explorer restart), so redo it on every fit.
    if (process.platform === 'win32') platform.attach(win, display);
  }

  // Windows drops WorkerW's children whenever Explorer rebuilds the desktop, so a
  // slow timer re-parents them. macOS keeps our window where we put it and opts out.
  startGuard() {
    if (this.guard || process.platform !== 'win32') return;
    this.guard = setInterval(() => {
      const displays = new Map(screen.getAllDisplays().map(describe).map((d) => [d.key, d]));
      for (const [key, win] of this.windows) {
        if (win.isDestroyed()) continue;
        platform.reassert(win, displays.get(key));
      }
    }, 2000);
    this.guard.unref?.();
  }

  stopGuard() {
    if (this.guard) clearInterval(this.guard);
    this.guard = null;
  }

  destroyAll() {
    this.stopGuard();
    this.sync.stop();
    for (const win of this.windows.values()) if (!win.isDestroyed()) win.destroy();
    this.windows.clear();
  }

  // --- state push ----------------------------------------------------------

  stateFor(key) {
    const cfg = store.displayConfig(key);
    const g = store.data.global;
    const spanning = g.spanMode && !!store.mediaById(g.span.mediaId) && !!this.span;

    // Span mode overrides the per-display clip and its playback settings: every
    // monitor is showing one image, so one set of values has to win.
    const look = spanning ? g.span : cfg;
    const item = store.mediaById(spanning ? g.span.mediaId : cfg.mediaId);

    const display = screen.getAllDisplays().map(describe).find((d) => d.key === key);
    // A spanned wallpaper's view is the whole multi-monitor canvas with this screen
    // offset into it; an ordinary one's view is just this screen.
    const view = !display ? null
      : spanning ? sliceFor(display, this.span)
      : soloView(display);

    return {
      key,
      media: item && {
        id: item.id,
        kind: item.kind,
        src: mediaUrl(item),
        poster: thumbUrl(item),
        duration: item.duration,
      },
      view,
      spanned: spanning,
      fit: look.fit || 'cover',
      zoom: look.zoom == null ? 1 : look.zoom,
      offsetX: look.offsetX || 0,
      offsetY: look.offsetY || 0,
      rate: look.rate,
      brightness: look.brightness,
      muted: g.muted || look.muted,
      volume: look.volume,
      paused: this.paused,
      sync: g.syncPlayback,
    };
  }

  push(key) {
    const win = this.windows.get(key);
    if (!win || win.isDestroyed()) return;
    win.webContents.send('wallpaper:state', this.stateFor(key));
  }

  pushAll() {
    for (const key of this.windows.keys()) this.push(key);
  }

  pushSync() {
    if (!store.data.global.syncPlayback || this.paused) return;
    for (const [key, win] of this.windows) {
      if (win.isDestroyed()) continue;
      const g = store.data.global;
      const mediaId = g.spanMode ? g.span.mediaId : store.displayConfig(key).mediaId;
      if (!mediaId) continue;
      win.webContents.send('wallpaper:sync', { elapsed: this.sync.elapsed(mediaId) });
    }
  }

  // --- controls ------------------------------------------------------------

  setPaused(paused) {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.pausedAt = Date.now();
      this.sync.stop();
    } else if (this.pausedAt) {
      // Shift every clock forward by the pause duration so resuming picks up where
      // it left off instead of jumping to "now".
      this.sync.rebase(Date.now() - this.pausedAt);
      this.pausedAt = null;
      if (this.windows.size) this.sync.start();
    }
    this.pushAll();
  }

  // Flash the monitor's name on each wallpaper, the way display settings panels do.
  identify() {
    const displays = screen.getAllDisplays().map(describe);
    for (const display of displays) {
      const win = this.windows.get(display.key);
      if (win && !win.isDestroyed()) {
        win.webContents.send('wallpaper:identify', { label: display.label, index: display.index + 1 });
      }
    }
  }

  resetGroup(mediaId) {
    this.sync.reset(mediaId);
  }
}

module.exports = { WallpaperWindows, displayKey };
