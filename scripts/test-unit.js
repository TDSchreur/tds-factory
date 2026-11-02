// @ts-check
import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = globSync('test/*.test.js')
  .filter((file) => !file.endsWith('-browser.test.js'))
  .sort();
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
