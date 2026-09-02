// Minimal animated-GIF encoder. Split out from the sample generator so the
// round-trip test can decode what it produces and compare against the source.

function lzwEncode(minCodeSize, indices) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let dict = new Map();

  const bytes = [];
  let acc = 0, accBits = 0;
  const emit = (code) => {
    acc |= code << accBits;
    accBits += codeSize;
    while (accBits >= 8) {
      bytes.push(acc & 0xff);
      acc >>>= 8;
      accBits -= 8;
    }
  };
  const reset = () => {
    dict = new Map();
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
  };

  emit(clearCode);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (nextCode <= 4095) {
      dict.set(key, nextCode);
      nextCode++;
      // The decoder's table lags the encoder's by exactly one entry (it adds
      // nothing for the first code after a clear), so the encoder has to widen
      // one code later than its own counter would suggest.
      if (nextCode === (1 << codeSize) + 1 && codeSize < 12) codeSize++;
    } else {
      emit(clearCode);
      reset();
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoiCode);
  if (accBits > 0) bytes.push(acc & 0xff);

  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return Buffer.from(out);
}

// Decoder used only by the test, to prove the encoder round-trips.
function lzwDecode(minCodeSize, buf) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let table = [];
  const resetTable = () => {
    table = [];
    for (let i = 0; i < clearCode; i++) table.push([i]);
    table.push(null, null); // clear, eoi
    codeSize = minCodeSize + 1;
  };
  resetTable();

  let acc = 0, accBits = 0, pos = 0;
  const readCode = () => {
    while (accBits < codeSize) {
      if (pos >= buf.length) return eoiCode;
      acc |= buf[pos++] << accBits;
      accBits += 8;
    }
    const code = acc & ((1 << codeSize) - 1);
    acc >>>= codeSize;
    accBits -= codeSize;
    return code;
  };

  const out = [];
  let prev = null;
  for (;;) {
    const code = readCode();
    if (code === eoiCode) break;
    if (code === clearCode) { resetTable(); prev = null; continue; }

    let entry;
    if (code < table.length && table[code]) entry = table[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error('bad code ' + code);

    out.push(...entry);
    if (prev) {
      if (table.length <= 4095) {
        table.push([...prev, entry[0]]);
        if (table.length === (1 << codeSize) && codeSize < 12) codeSize++;
      }
    }
    prev = entry;
  }
  return out;
}

// Strip GIF sub-block framing back into one buffer.
function unblock(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const len = buf[i++];
    if (len === 0) break;
    for (let j = 0; j < len; j++) out.push(buf[i + j]);
    i += len;
  }
  return Buffer.from(out);
}

function buildGif({ width, height, palette, frames, delayCs = 5 }) {
  const parts = [Buffer.from('GIF89a', 'ascii')];

  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0);
  lsd.writeUInt16LE(height, 2);
  lsd[4] = 0x80 | (7 << 4) | 7; // global colour table, 256 entries
  parts.push(lsd, Buffer.from(palette));

  parts.push(Buffer.from([
    0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'ascii'),
    0x03, 0x01, 0x00, 0x00, 0x00, // loop forever
  ]));

  for (const px of frames) {
    const gce = Buffer.alloc(8);
    gce[0] = 0x21; gce[1] = 0xf9; gce[2] = 0x04; gce[3] = 0x00;
    gce.writeUInt16LE(delayCs, 4);
    parts.push(gce);

    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(width, 5);
    desc.writeUInt16LE(height, 7);
    parts.push(desc, Buffer.from([8]), lzwEncode(8, px));
  }

  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

module.exports = { lzwEncode, lzwDecode, unblock, buildGif };
