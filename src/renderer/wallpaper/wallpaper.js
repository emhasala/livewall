'use strict';

// One of these runs per monitor, inside a window pinned to the desktop layer.
// It owns two <video> and two <img> layers so swapping wallpapers can crossfade
// instead of flashing black, and it corrects its own drift against the clock in main.
//
// Every layer is positioned explicitly from shared/layout.js rather than left to
// object-fit, because fit, zoom, pan and multi-monitor spanning are all the same
// calculation — and the arrange-canvas preview runs that identical code.

const DRIFT_TOLERANCE = 0.35; // seconds before we hard-seek
const NUDGE_TOLERANCE = 0.08; // below this, fix drift with playbackRate instead

const els = {
  backdrop: document.getElementById('backdrop'),
  shade: document.getElementById('shade'),
  identify: document.getElementById('identify'),
  identifyLabel: document.getElementById('identifyLabel'),
  video: [document.getElementById('layerA'), document.getElementById('layerB')],
  still: [document.getElementById('stillA'), document.getElementById('stillB')],
};

let front = 0;        // index of the layer currently visible
let current = null;   // media id on screen
let state = null;
let identifyTimer = null;

const allLayers = () => [...els.video, ...els.still];
const naturalOf = (el) => ({
  w: el.videoWidth || el.naturalWidth || 0,
  h: el.videoHeight || el.naturalHeight || 0,
});

function placeLayer(el, s) {
  const { w, h } = naturalOf(el);
  if (!s || !s.view || !w || !h) return false;
  const box = Layout.place(w, h, s.view, {
    mode: s.fit,
    zoom: s.zoom,
    offsetX: s.offsetX,
    offsetY: s.offsetY,
  });
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
  el.style.left = `${box.left}px`;
  el.style.top = `${box.top}px`;
  return true;
}

function applyLook(s) {
  for (const el of allLayers()) placeLayer(el, s);

  // "blur" fills the letterbox with a blown-up copy of the poster frame. Using the
  // still rather than a second video keeps it to one decode per screen.
  const wantBackdrop = s.fit === 'blur'
    && !!(s.media && s.media.poster)
    && !!s.view
    && Layout.letterboxed(
      naturalOf(liveLayer()).w || 16,
      naturalOf(liveLayer()).h || 9,
      s.view,
      { mode: s.fit, zoom: s.zoom, offsetX: s.offsetX, offsetY: s.offsetY });
  els.backdrop.classList.toggle('on', wantBackdrop);
  if (s.media && s.media.poster) els.backdrop.style.backgroundImage = `url("${s.media.poster}")`;

  // Brightness is a black scrim rather than a CSS filter: compositing one flat layer
  // is far cheaper per frame than re-filtering every decoded video frame.
  els.shade.style.opacity = String(Math.max(0, 1 - (s.brightness == null ? 1 : s.brightness)));
}

function liveLayer() {
  return els.still[front].classList.contains('on') ? els.still[front] : els.video[front];
}

function applyPlayback(s) {
  const video = els.video[front];
  if (!video.getAttribute('src')) return;
  video.muted = !!s.muted;
  video.volume = s.muted ? 0 : Math.min(1, Math.max(0, s.volume || 0));
  video.defaultPlaybackRate = s.rate || 1;
  if (s.paused) {
    video.pause();
  } else {
    video.playbackRate = s.rate || 1;
    // Autoplay is unblocked via autoplayPolicy, but a rejected play() must not take
    // the rest of the update down with it.
    video.play().catch(() => {});
  }
}

function swapTo(media, s) {
  const next = 1 - front;
  current = media.id;

  if (media.kind === 'image') {
    const img = els.still[next];
    // Hold the crossfade until the image has decoded, or switching wallpapers
    // flashes black on large photos — same reason the video path waits.
    img.onload = () => {
      placeLayer(img, state);
      reveal(next, true);
      applyLook(state);
    };
    img.onerror = () => reportMediaError(media, 'image');
    img.src = media.src;
    return;
  }

  const video = els.video[next];
  video.src = media.src;
  video.loop = true;
  video.muted = !!s.muted;
  video.volume = s.muted ? 0 : Math.min(1, Math.max(0, s.volume || 0));
  video.playbackRate = s.rate || 1;
  const show = () => {
    video.removeEventListener('loadeddata', show);
    placeLayer(video, state);
    reveal(next, false);
    applyLook(state);
    if (!s.paused) video.play().catch(() => {});
  };
  video.addEventListener('loadeddata', show);
  video.load();
}

function reveal(next, isStill) {
  const showing = isStill ? els.still[next] : els.video[next];
  showing.classList.add('on');
  for (const el of [els.video[front], els.still[front]]) el.classList.remove('on');
  const oldFront = front;
  front = next;
  // Release the retired layer's decoder once the crossfade has finished.
  setTimeout(() => {
    const stale = els.video[oldFront];
    if (!stale.classList.contains('on')) {
      stale.pause();
      stale.removeAttribute('src');
      stale.load();
    }
    if (!els.still[oldFront].classList.contains('on')) els.still[oldFront].removeAttribute('src');
  }, 700);
}

function clearAll() {
  for (const el of els.video) {
    el.classList.remove('on');
    el.pause();
    el.removeAttribute('src');
    el.load();
  }
  for (const el of els.still) {
    el.classList.remove('on');
    el.removeAttribute('src');
  }
  els.backdrop.classList.remove('on');
  current = null;
}

// Tell the app when a file can't be decoded here. Chromium plays a narrower set of
// codecs than the container extension suggests, and a silent black screen gives the
// user nothing to act on.
function reportMediaError(media, kind, detail) {
  window.wallpaper.mediaError({
    id: media.id,
    kind,
    detail: detail || null,
  });
}

window.wallpaper.onState((s) => {
  state = s;
  if (!s.media) {
    clearAll();
    return;
  }
  if (s.media.id !== current) swapTo(s.media, s);
  else applyPlayback(s);
  applyLook(s);
});

// Drift correction. Small offsets are absorbed by briefly running slightly fast or
// slow, which is invisible; only a real gap (a stalled decode, a monitor that woke
// up late) justifies a seek, because seeking shows a visible hitch.
window.wallpaper.onSync(({ elapsed }) => {
  const video = els.video[front];
  if (!state || state.paused || !state.sync) return;
  if (!video.getAttribute('src') || !video.duration || !isFinite(video.duration)) return;

  const target = elapsed % video.duration;
  let drift = video.currentTime - target;
  // Wrap the shortest way around the loop point.
  if (drift > video.duration / 2) drift -= video.duration;
  if (drift < -video.duration / 2) drift += video.duration;

  const rate = state.rate || 1;
  if (Math.abs(drift) > DRIFT_TOLERANCE) {
    video.currentTime = target;
    video.playbackRate = rate;
  } else if (Math.abs(drift) > NUDGE_TOLERANCE) {
    video.playbackRate = rate * (drift > 0 ? 0.97 : 1.03);
  } else {
    video.playbackRate = rate;
  }
});

window.wallpaper.onIdentify(({ label, index }) => {
  els.identifyLabel.textContent = `${index} · ${label}`;
  els.identify.hidden = false;
  clearTimeout(identifyTimer);
  identifyTimer = setTimeout(() => { els.identify.hidden = true; }, 2600);
});

// A decode failure shouldn't leave a dead black rectangle with no explanation: fall
// back to the poster frame so something sensible is on screen, and tell the app.
for (const video of els.video) {
  video.addEventListener('error', () => {
    if (!state || !state.media) return;
    const err = video.error;
    reportMediaError(state.media, 'video', err && err.message ? err.message : `code ${err && err.code}`);
    if (!state.media.poster) return;
    const img = els.still[front];
    img.onload = () => { placeLayer(img, state); };
    img.src = state.media.poster;
    img.classList.add('on');
    video.classList.remove('on');
  });
}

// Re-place on resize: a monitor's resolution can change under us.
window.addEventListener('resize', () => { if (state) applyLook(state); });
