const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const temp = path.resolve(__dirname, '../evidence/test-temp');
fs.mkdirSync(temp, { recursive: true });
const files = fs
  .readdirSync(path.resolve(__dirname, '../tests'))
  .filter((f) => f.endsWith('.test.cjs'))
  .map((f) => path.resolve(__dirname, '../tests', f));
const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
