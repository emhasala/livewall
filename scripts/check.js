// Syntax-checks every source file the app loads. Catches typos in files that only
// run inside a renderer, where a mistake would otherwise surface as a blank window.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const roots = ['src', 'scripts'];
const files = [];
for (const root of roots) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  }
}

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log('  ok  ' + file);
  } catch (err) {
    failed++;
    console.error('FAIL  ' + file + '\n' + err.stderr.toString());
  }
}
console.log(failed ? `${failed} file(s) failed` : `${files.length} files OK`);
process.exit(failed ? 1 : 0);
