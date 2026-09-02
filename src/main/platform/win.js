// Windows: park our wallpaper windows inside WorkerW, the window Explorer keeps
// between the desktop wallpaper and the icon layer. The 0x052C message that spawns
// it is undocumented but has been stable since Windows 7 and is what every wallpaper
// app on the platform relies on. Done through koffi FFI so there's nothing to compile.
const { screen } = require('electron');

let api = null;
let loadError = null;

function api32() {
  if (api || loadError) return api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(uintptr_t hwnd, intptr_t lParam)');
    api = {
      koffi,
      EnumWindowsProc,
      FindWindowExW: user32.func('uintptr_t __stdcall FindWindowExW(uintptr_t parent, uintptr_t after, str16 cls, str16 title)'),
      SendMessageTimeoutW: user32.func('intptr_t __stdcall SendMessageTimeoutW(uintptr_t hWnd, uint32_t msg, uintptr_t wParam, intptr_t lParam, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *result)'),
      EnumWindows: user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)'),
      SetParent: user32.func('uintptr_t __stdcall SetParent(uintptr_t child, uintptr_t parent)'),
      SetWindowPos: user32.func('bool __stdcall SetWindowPos(uintptr_t hWnd, uintptr_t after, int x, int y, int cx, int cy, uint32_t flags)'),
      ShowWindow: user32.func('bool __stdcall ShowWindow(uintptr_t hWnd, int cmd)'),
      GetSystemMetrics: user32.func('int __stdcall GetSystemMetrics(int index)'),
      GetForegroundWindow: user32.func('uintptr_t __stdcall GetForegroundWindow()'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(uintptr_t hWnd, _Out_ int *rect)'),
    };
  } catch (err) {
    loadError = err;
    console.error('[win] koffi unavailable, wallpaper windows will float above the desktop:', err.message);
  }
  return api;
}

function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length === 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
}

// Ask Progman to spawn a WorkerW, then find the one that is NOT the icon host.
function findWorkerW(a) {
  const progman = a.FindWindowExW(0n, 0n, 'Progman', null);
  if (progman) {
    const out = [0n];
    a.SendMessageTimeoutW(progman, 0x052c, 0n, 0, 0x0000, 1000, out);
  }

  let worker = 0n;
  const cb = a.koffi.register((hwnd) => {
    const defView = a.FindWindowExW(hwnd, 0n, 'SHELLDLL_DefView', null);
    if (defView) {
      // The sibling WorkerW that follows the icon host is the paint layer we want.
      const sibling = a.FindWindowExW(0n, hwnd, 'WorkerW', null);
      if (sibling) {
        worker = sibling;
        return false; // stop enumerating
      }
    }
    return true;
  }, a.koffi.pointer(a.EnumWindowsProc));

  try {
    a.EnumWindows(cb, 0);
  } finally {
    a.koffi.unregister(cb);
  }
  return worker;
}

const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_SHOWWINDOW = 0x0040;

function attach(win, display) {
  const a = api32();
  if (!a || win.isDestroyed()) return false;
  try {
    const worker = findWorkerW(a);
    if (!worker) {
      console.error('[win] WorkerW not found; leaving window at normal level');
      return false;
    }
    const hwnd = hwndOf(win);
    a.SetParent(hwnd, worker);

    // WorkerW's client area spans the whole virtual desktop, with its origin at the
    // top-left-most monitor. Electron hands us DIP bounds in that same space, so
    // convert to physical pixels and rebase onto the virtual origin.
    const rect = screen.dipToScreenRect(null, display.bounds);
    const vx = a.GetSystemMetrics(76); // SM_XVIRTUALSCREEN
    const vy = a.GetSystemMetrics(77); // SM_YVIRTUALSCREEN
    a.SetWindowPos(
      hwnd, 0n,
      rect.x - vx, rect.y - vy, rect.width, rect.height,
      SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW
    );
    return true;
  } catch (err) {
    console.error('[win] failed to attach to desktop:', err.message);
    return false;
  }
}

// A window covering an entire monitor with no border is almost certainly a game or
// a fullscreen video, so we stop decoding behind it.
function foregroundIsFullscreen() {
  const a = api32();
  if (!a) return false;
  try {
    const hwnd = a.GetForegroundWindow();
    if (!hwnd) return false;
    const rect = [0, 0, 0, 0];
    if (!a.GetWindowRect(hwnd, rect)) return false;
    const [left, top, right, bottom] = rect;
    return screen.getAllDisplays().some((d) => {
      const r = screen.dipToScreenRect(null, d.bounds);
      return left <= r.x && top <= r.y && right >= r.x + r.width && bottom >= r.y + r.height;
    });
  } catch {
    return false;
  }
}

// Explorer drops WorkerW children when the desktop is rebuilt, so re-parenting on
// a timer keeps the wallpaper alive across those events.
function reassert(win, display) {
  return attach(win, display);
}

module.exports = { attach, reassert, foregroundIsFullscreen, hwndOf };
