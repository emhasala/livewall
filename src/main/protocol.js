// Media is served over a custom scheme rather than file://.
//
// Chromium refuses to load file:// URLs into a <video> ("Media load rejected by URL
// safety check") even from a file:// page — <img> is allowed, <video> is not. A
// privileged scheme sidesteps that, and lets us answer Range requests properly so
// seeking and looping stay cheap on large files instead of re-reading from the top.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { protocol, net } = require('electron');
const { store } = require('./store');

const SCHEME = 'livewall';

const TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.ogv': 'video/ogg',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp',
};

// Must run before app 'ready'.
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  }]);
}

function resolve(kind, name) {
  // Only ever a bare filename inside our own store — no traversal, no absolute paths.
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  const dir = kind === 'thumb' ? store.thumbDir : store.mediaDir;
  const file = path.join(dir, name);
  if (path.dirname(file) !== path.resolve(dir)) return null;
  return file;
}

function install() {
  protocol.handle(SCHEME, async (request) => {
    let file;
    try {
      const url = new URL(request.url);
      file = resolve(url.hostname, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    } catch {
      return new Response(null, { status: 400 });
    }
    if (!file) return new Response(null, { status: 403 });

    let stat;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      return new Response(null, { status: 404 });
    }

    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = request.headers.get('Range');
    const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());

    if (match) {
      // A media element seeking (or just starting) asks for a byte range; answering
      // 206 keeps it from pulling the whole file for every scrub.
      const size = stat.size;
      let start = match[1] === '' ? null : Number(match[1]);
      let end = match[2] === '' ? null : Number(match[2]);
      if (start === null) {                 // suffix form: bytes=-N
        start = Math.max(0, size - (end || 0));
        end = size - 1;
      } else if (end === null || end >= size) {
        end = size - 1;
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      }
      const stream = fs.createReadStream(file, { start, end });
      return new Response(Readable.toWeb(stream), {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        },
      });
    }

    return new Response(Readable.toWeb(fs.createReadStream(file)), {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(stat.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      },
    });
  });
}

const mediaUrl = (item) => (item ? `${SCHEME}://media/${encodeURIComponent(item.file)}` : null);
const thumbUrl = (item) => (item && item.thumb ? `${SCHEME}://thumb/${encodeURIComponent(item.thumb)}` : null);

module.exports = { SCHEME, registerScheme, install, mediaUrl, thumbUrl };
