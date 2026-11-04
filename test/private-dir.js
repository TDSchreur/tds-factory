import { mkdtempSync, rmSync, chmodSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Installing refuses shared temp folders (sticky or world-writable), so tests that run the real trust check need a
// private folder. On Linux it lives inside the checkout; on Windows in the home folder, where the ACL is inherited from the user.
// It is removed when the process exits. Use a prefix that .gitignore lists.
/** @type {string[]} */
const made = [];
process.on('exit', () => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** @param {string} prefix A name starting with a dot, for example `.install-e2e-`. */
export function privateDir(prefix) {
  const dir = realpathSync.native(mkdtempSync(join(process.platform === 'win32' ? homedir() : process.cwd(), prefix)));
  if (process.platform !== 'win32') chmodSync(dir, 0o700);
  made.push(dir);
  return dir;
}
