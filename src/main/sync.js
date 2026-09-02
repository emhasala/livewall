// Keeps monitors showing the same clip frame-aligned. One authoritative clock per
// media id lives here; each wallpaper renderer nudges its own <video> toward it and
// only hard-seeks when drift exceeds a threshold, so normal playback stays smooth.
const TICK_MS = 2000;

class SyncClock {
  constructor(onTick) {
    this.origins = new Map(); // mediaId -> epoch ms the group's loop started
    this.timer = null;
    this.onTick = onTick;
  }

  originFor(mediaId) {
    if (!this.origins.has(mediaId)) this.origins.set(mediaId, Date.now());
    return this.origins.get(mediaId);
  }

  elapsed(mediaId) {
    return (Date.now() - this.originFor(mediaId)) / 1000;
  }

  // Called when playback resumes after a pause so monitors don't all jump forward
  // by however long the app was idle.
  rebase(pausedForMs) {
    for (const [id, origin] of this.origins) this.origins.set(id, origin + pausedForMs);
  }

  reset(mediaId) {
    if (mediaId) this.origins.delete(mediaId);
    else this.origins.clear();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.onTick(), TICK_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { SyncClock };
