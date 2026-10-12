const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
for (const file of ['src/main.cjs', 'src/preload.cjs', 'src/store.cjs', 'src/renderer.js']) {
  assert.ok(fs.existsSync(file), 'Missing ' + file);
  cp.execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
for (const test of JSON.parse(
  fs.readFileSync('tests/frozen-manifest.json', 'utf8').replace(/^\uFEFF/, ''),
)) {
  const actual = require('node:crypto')
    .createHash('sha256')
    .update(fs.readFileSync(path.join('tests', test.file)))
    .digest('hex')
    .toUpperCase();
  assert.equal(actual, test.sha256, 'Frozen test changed: ' + test.file);
}
const html = fs.readFileSync('src/index.html', 'utf8');
assert.ok(html.includes('Content-Security-Policy'));
assert.ok(!/<script[^>]*>\s*[^<\s]/.test(html), 'No inline JS');
console.log('Syntax, local entry and frozen-test hashes OK.');
