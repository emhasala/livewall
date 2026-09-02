const fs = require('fs');
const path = require('path');
const { buildGif } = require('./lib/gif');
const aurora = require('./lib/aurora');

const frames = [];
for (let n = 0; n < aurora.FRAMES; n++) frames.push(aurora.frame(n));

const gif = buildGif({
  width: aurora.W,
  height: aurora.H,
  palette: aurora.palette(),
  frames,
  delayCs: 5,
});

const out = path.join(__dirname, '..', 'assets', 'sample-aurora.gif');
fs.writeFileSync(out, gif);
console.log('wrote assets/sample-aurora.gif', (gif.length / 1024).toFixed(0) + 'KB');
