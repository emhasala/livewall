const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { store } = require('./store');

const VIDEO_EXT = ['.mp4', '.m4v', '.webm', '.mov', '.mkv', '.ogv'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp'];
const ALL_EXT = [...VIDEO_EXT, ...IMAGE_EXT];

// Formats people genuinely try to use that Chromium cannot decode. Naming them
// explicitly turns a black wallpaper into an actionable message.
const UNDECODABLE = {
  '.heic': 'HEIC images can\'t be decoded — convert to JPEG or PNG first (Preview ▸ File ▸ Export).',
  '.heif': 'HEIF images can\'t be decoded — convert to JPEG or PNG first (Preview ▸ File ▸ Export).',
  '.tiff': 'TIFF images can\'t be decoded — convert to PNG or JPEG first.',
  '.tif': 'TIFF images can\'t be decoded — convert to PNG or JPEG first.',
  '.avi': 'AVI usually holds codecs that can\'t be decoded — convert to MP4 (H.264) first.',
  '.wmv': 'WMV can\'t be decoded — convert to MP4 (H.264) first.',
  '.flv': 'FLV can\'t be decoded — convert to MP4 (H.264) first.',
};

function kindFor(ext) {
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (IMAGE_EXT.includes(ext)) return 'image';
  return null;
}

// Chromium can only decode a subset of container/codec combos. .mov and .mkv often
// carry codecs it can't touch, so flag them rather than silently showing black.
function needsTranscodeHint(ext) {
  return ext === '.mkv' || ext === '.mov' || ext === '.ogv';
}

function importFiles(paths) {
  const added = [];
  const skipped = [];
  for (const src of paths) {
    const ext = path.extname(src).toLowerCase();
    const kind = kindFor(ext);
    if (!kind) {
      const name = path.basename(src);
      skipped.push({
        path: src,
        reason: UNDECODABLE[ext]
          ? `${name}: ${UNDECODABLE[ext]}`
          : `${name}: unsupported file type (${ext || 'no extension'})`,
      });
      continue;
    }
    let stat;
    try {
      stat = fs.statSync(src);
    } catch {
      skipped.push({ path: src, reason: 'File could not be read' });
      continue;
    }
    if (!stat.isFile()) {
      skipped.push({ path: src, reason: 'Not a file' });
      continue;
    }

    const id = crypto.randomUUID();
    const file = `${id}${ext}`;
    try {
      fs.copyFileSync(src, path.join(store.mediaDir, file));
    } catch (err) {
      skipped.push({ path: src, reason: `Copy failed: ${err.message}` });
      continue;
    }

    const item = {
      id,
      kind,
      file,
      name: path.basename(src, ext),
      bytes: stat.size,
      addedAt: Date.now(),
      duration: null,
      width: null,
      height: null,
      thumb: null,
      hint: needsTranscodeHint(ext) ? 'container' : null,
    };
    store.addMedia(item);
    added.push(item);
  }
  return { added, skipped };
}

function removeMedia(id) {
  const item = store.removeMedia(id);
  if (!item) return false;
  for (const p of [path.join(store.mediaDir, item.file), item.thumb && path.join(store.thumbDir, item.thumb)]) {
    if (p) fs.rmSync(p, { force: true });
  }
  return true;
}

function saveThumb(id, dataUrl) {
  const match = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(dataUrl || '');
  if (!match) return null;
  const file = `${id}.${match[1] === 'png' ? 'png' : 'jpg'}`;
  fs.writeFileSync(path.join(store.thumbDir, file), Buffer.from(match[2], 'base64'));
  return file;
}

function mediaPath(item) {
  return item ? path.join(store.mediaDir, item.file) : null;
}

function thumbPath(item) {
  return item && item.thumb ? path.join(store.thumbDir, item.thumb) : null;
}

module.exports = { importFiles, removeMedia, saveThumb, mediaPath, thumbPath, ALL_EXT, VIDEO_EXT, IMAGE_EXT };
