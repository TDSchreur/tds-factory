import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = readdirSync('test')
  .filter((file) => file.endsWith('.test.js') && !file.endsWith('-browser.test.js'))
  .sort()
  .map((file) => `test/${file}`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
