const { screen } = require('electron');

// Electron's display.id is only stable for the current session; monitors that get
// unplugged and replugged come back with a new id. Key on physical identity instead
// so a monitor keeps its wallpaper across reconnects and reboots.
function displayKey(display) {
  const label = (display.label || '').trim();
  const { width, height } = display.size;
  const base = label || `display-${display.id}`;
  return `${base}@${width}x${height}`;
}

function describe(display, index) {
  return {
    key: displayKey(display),
    id: display.id,
    index,
    label: (display.label || '').trim() || `Display ${index + 1}`,
    bounds: display.bounds,
    workArea: display.workArea,
    size: display.size,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    internal: display.internal,
    primary: display.id === screen.getPrimaryDisplay().id,
  };
}

function listDisplays() {
  return screen.getAllDisplays().map(describe);
}

module.exports = { displayKey, listDisplays, describe };
