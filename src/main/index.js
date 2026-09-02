const path = require('path');
const { app, BrowserWindow, ipcMain, Tray, Menu, screen, dialog, nativeImage, powerMonitor, shell } = require('electron');
const mediaProtocol = require('./protocol');
const { store } = require('./store');
const { listDisplays } = require('./displays');
const { rectFor, spanRect } = require('./arrange');
const mediaLib = require('./media');
const { WallpaperWindows } = require('./wallpaper-windows');
const platform = require('./platform');

const isDev = process.argv.includes('--dev');
let tray = null;
let controlWindow = null;
let wallpapers = null;
let fullscreenPoll = null;
let autoPaused = false;

// --- control window ---------------------------------------------------------

function openControlWindow() {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.show();
    controlWindow.focus();
    return controlWindow;
  }
  controlWindow = new BrowserWindow({
    width: 1140,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: 'LiveWall',
    backgroundColor: '#0d0e12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'control.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  controlWindow.loadFile(path.join(__dirname, '..', 'renderer', 'control', 'index.html'));
  if (isDev) controlWindow.webContents.openDevTools({ mode: 'detach' });
  controlWindow.on('closed', () => { controlWindow = null; });
  return controlWindow;
}

function snapshot() {
  const displays = listDisplays().map((d) => ({
    ...d,
    config: store.displayConfig(d.key),
    // Where this monitor sits for wallpaper purposes: the OS layout unless the
    // user has dragged it somewhere else in the arrange canvas.
    rect: rectFor(d),
  }));
  const taking = displays.filter((d) => d.config.enabled);
  return {
    platform: process.platform,
    global: store.data.global,
    paused: store.data.global.paused || autoPaused,
    displays,
    span: spanRect(taking.length ? taking : displays),
    library: store.data.library.map(withUrls),
    autoPaused,
  };
}

function withUrls(item) {
  return {
    ...item,
    src: mediaProtocol.mediaUrl(item),
    thumbUrl: mediaProtocol.thumbUrl(item),
  };
}

function broadcast() {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send('app:changed', snapshot());
  }
  updateTray();
}

// --- tray -------------------------------------------------------------------

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'trayTemplate.png'));
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

function updateTray() {
  if (!tray) return;
  const g = store.data.global;
  const active = listDisplays().filter((d) => store.displayConfig(d.key).mediaId).length;
  tray.setToolTip(`LiveWall — ${active} of ${listDisplays().length} displays`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: (g.paused || autoPaused) ? 'Resume wallpapers' : 'Pause wallpapers',
      click: () => setPaused(!(g.paused || autoPaused)) },
    { label: g.muted ? 'Unmute' : 'Mute', click: () => { store.setGlobal({ muted: !g.muted }); wallpapers.pushAll(); broadcast(); } },
    { type: 'separator' },
    { label: 'Open LiveWall…', click: openControlWindow },
    { label: 'Identify displays', click: () => wallpapers.identify() },
    { type: 'separator' },
    { label: 'Quit LiveWall', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

// `paused` in the config is the user's own choice and persists. Automatic pausing
// (battery, fullscreen) is deliberately NOT persisted: it lives only in autoPaused,
// so unplugging the charger once can't leave the wallpapers paused forever — which
// is exactly what happened when both shared one stored flag.
function setPaused(paused, { auto = false } = {}) {
  if (auto) autoPaused = paused;
  else store.setGlobal({ paused });
  applyPauseState();
}

function applyPauseState() {
  const effective = store.data.global.paused || autoPaused;
  wallpapers.setPaused(effective);
  broadcast();
}

// --- automatic pausing ------------------------------------------------------

function watchPower() {
  const onPower = () => {
    if (!store.data.global.pauseOnBattery) return;
    setPaused(powerMonitor.isOnBatteryPower(), { auto: true });
  };
  powerMonitor.on('on-battery', onPower);
  powerMonitor.on('on-ac', onPower);
  powerMonitor.on('suspend', () => wallpapers.setPaused(true));
  powerMonitor.on('resume', () => applyPauseState());
  onPower();
}

// Windows only — see platform/mac.js for why macOS opts out.
function watchFullscreen() {
  if (process.platform !== 'win32') return;
  fullscreenPoll = setInterval(() => {
    if (!store.data.global.pauseOnFullscreen) return;
    setPaused(platform.foregroundIsFullscreen(), { auto: true });
  }, 4000);
  fullscreenPoll.unref?.();
}

// --- IPC --------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('app:snapshot', () => snapshot());

  ipcMain.handle('config:global', (_e, patch) => {
    store.setGlobal(patch);
    if ('launchAtLogin' in patch) {
      app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin, openAsHidden: true });
    }
    if ('paused' in patch) applyPauseState();
    if ('syncPlayback' in patch) wallpapers.resetGroup(null);
    // Switching span on/off, or swapping the spanned clip, changes which windows
    // should exist and restarts the shared clock.
    if ('spanMode' in patch || (patch.span && 'mediaId' in patch.span)) {
      wallpapers.resetGroup(null);
      wallpapers.reconcile();
    }
    // Changes the area each window covers, so the windows have to be re-fitted.
    if ('useWorkArea' in patch) wallpapers.reconcile();
    wallpapers.pushAll();
    broadcast();
    return snapshot();
  });

  ipcMain.handle('config:arrangement', (_e, map) => {
    store.setArrangement(map);
    // Only the slicing changed, so the windows themselves stay put — but every
    // one of them needs its new slice.
    wallpapers.reconcile();
    broadcast();
    return snapshot();
  });

  ipcMain.handle('config:display', (_e, { keys, patch }) => {
    store.setDisplay(keys, patch);
    // A new clip on a monitor restarts that sync group, otherwise it would be told
    // to seek to however long the previous clip had been running.
    if ('mediaId' in patch) wallpapers.resetGroup(patch.mediaId);
    wallpapers.reconcile();
    broadcast();
    return snapshot();
  });

  ipcMain.handle('media:pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(controlWindow, {
      title: 'Add wallpapers',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Videos & images', extensions: mediaLib.ALL_EXT.map((e) => e.slice(1)) },
        { name: 'Videos', extensions: mediaLib.VIDEO_EXT.map((e) => e.slice(1)) },
        { name: 'Images', extensions: mediaLib.IMAGE_EXT.map((e) => e.slice(1)) },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (canceled) return { added: [], skipped: [] };
    return importAndBroadcast(filePaths);
  });

  ipcMain.handle('media:import', (_e, paths) => importAndBroadcast(paths));

  ipcMain.handle('media:remove', (_e, id) => {
    mediaLib.removeMedia(id);
    wallpapers.reconcile();
    broadcast();
    return snapshot();
  });

  // The control renderer probes each clip for duration/size and grabs a poster
  // frame — main has no canvas, and doing it there would mean bundling ffmpeg.
  ipcMain.handle('media:meta', (_e, { id, duration, width, height, thumb }) => {
    const patch = { duration, width, height, undecodable: false, error: null };
    if (thumb) {
      const file = mediaLib.saveThumb(id, thumb);
      if (file) patch.thumb = file;
    }
    store.updateMedia(id, patch);
    wallpapers.pushAll();
    broadcast();
    return snapshot();
  });

  ipcMain.handle('media:rename', (_e, { id, name }) => {
    store.updateMedia(id, { name: String(name || '').slice(0, 120) || 'Untitled' });
    broadcast();
    return snapshot();
  });

  // A wallpaper renderer reporting a file it can't decode. Chromium supports a
  // narrower set of codecs than file extensions imply, so surface it in the UI
  // instead of leaving a black screen with no explanation.
  ipcMain.on('wallpaper:media-error', (_e, { id, detail }) => {
    const item = store.mediaById(id);
    if (!item || item.undecodable) return;
    store.updateMedia(id, { undecodable: true, error: detail || null });
    broadcast();
  });

  ipcMain.handle('displays:identify', () => { wallpapers.identify(); });
  ipcMain.handle('app:open-media-folder', () => shell.openPath(store.mediaDir));
  ipcMain.handle('app:quit', () => { app.isQuitting = true; app.quit(); });
}

function importAndBroadcast(paths) {
  const result = mediaLib.importFiles(paths);
  broadcast();
  return { added: result.added.map(withUrls), skipped: result.skipped };
}

// Give a brand-new install something to look at instead of an empty grid.
function seedSampleWallpaper() {
  if (!store.firstRun || store.data.library.length) return;
  const sample = path.join(__dirname, '..', '..', 'assets', 'sample-aurora.gif');
  try {
    const { added } = mediaLib.importFiles([sample]);
    if (added[0]) store.updateMedia(added[0].id, { name: 'Aurora' });
  } catch (err) {
    console.error('[boot] could not seed sample wallpaper:', err.message);
  }
}

// --- boot -------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', openControlWindow);

  // Has to happen before 'ready'.
  mediaProtocol.registerScheme();

  app.whenReady().then(() => {
    store.load();
    mediaProtocol.install();
    seedSampleWallpaper();
    wallpapers = new WallpaperWindows();
    registerIpc();

    tray = new Tray(trayIcon());
    tray.on('click', openControlWindow);
    updateTray();

    wallpapers.reconcile();
    applyPauseState();
    openControlWindow();

    // Monitors plugged in, unplugged, rearranged, or resolution-changed.
    for (const evt of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(evt, () => { wallpapers.reconcile(); broadcast(); });
    }

    watchPower();
    watchFullscreen();

    app.on('activate', openControlWindow);
  });

  // Closing the control window leaves the wallpapers running; this is a tray app.
  app.on('window-all-closed', (e) => e.preventDefault?.());

  app.on('before-quit', () => {
    app.isQuitting = true;
    if (fullscreenPoll) clearInterval(fullscreenPoll);
    if (wallpapers) wallpapers.destroyAll();
  });
}
