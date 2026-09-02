// macOS needs no native helper: Electron's `type: 'desktop'` window sits at the
// desktop level, below the icon layer, which is exactly where a wallpaper belongs.
// All that's left is making it follow the user across Spaces and ignore the mouse.
function attach(win) {
  if (win.isDestroyed()) return true;
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true });
  win.setIgnoreMouseEvents(true, { forward: false });
  return true;
}

// Nothing to re-assert: macOS keeps the window where we put it. (Windows does not,
// hence the counterpart in win.js.)
function reassert() {
  return true;
}

// No sanctioned API for "is something fullscreen in front of me" without either
// private AppKit calls or an Automation permission prompt. The desktop-level window
// is already occluded (and throttled by the OS) in that case, so we don't fake it.
function foregroundIsFullscreen() {
  return false;
}

module.exports = { attach, reassert, foregroundIsFullscreen };
