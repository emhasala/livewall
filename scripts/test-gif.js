// Round-trips the LZW encoder against its decoder. A GIF that decodes to
// anything other than the exact source indices is a corrupt animation.
const assert = require('assert');
const { lzwEncode, lzwDecode, unblock } = require('./lib/gif');
const aurora = require('./lib/aurora');

function roundTrip(name, indices) {
  const encoded = unblock(lzwEncode(8, indices));
  const decoded = lzwDecode(8, encoded);
  assert.strictEqual(decoded.length, indices.length, `${name}: length mismatch`);
  for (let i = 0; i < indices.length; i++) {
    if (decoded[i] !== indices[i]) {
      assert.fail(`${name}: byte ${i} — expected ${indices[i]}, got ${decoded[i]}`);
    }
  }
  console.log(`  ok  ${name} (${indices.length} px)`);
}

// Flat data stays inside the initial code width; ramps and noise force the
// encoder through every code-size widening, which is where the off-by-one hides.
roundTrip('flat', new Uint8Array(5000));
roundTrip('ramp', Uint8Array.from({ length: 20000 }, (_, i) => i % 256));
roundTrip('two-tone', Uint8Array.from({ length: 20000 }, (_, i) => (i % 7 < 3 ? 1 : 250)));

let seed = 12345;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256;
roundTrip('noise', Uint8Array.from({ length: 60000 }, rand));

for (const n of [0, 7, 31]) roundTrip(`aurora frame ${n}`, aurora.frame(n));

console.log('GIF LZW round-trip: all passed');
