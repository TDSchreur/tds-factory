// @ts-check
// Runs a command with its own temporary directory and removes that directory afterwards.
// Usage: node scripts/with-temp-dir.js <command> [args...]
// The tests and evals make many folders in the temp directory and none of them removes its own. Pointing
// TMPDIR (macOS, Linux) and TMP and TEMP (Windows) at one folder per run turns "clean up after every test"
// into "remove one folder", also when the command fails or is interrupted.
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/with-temp-dir.js <command> [args...]');
  process.exit(1);
}

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tds-run-')));
const remove = () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
// npm and tds-factory are .cmd shims on Windows, which spawn only runs through a shell.
const child = spawn(command, args, {
  stdio: 'inherit',
  env: { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir },
  shell: process.platform === 'win32' && /^(npm|npx|tds-factory)$/.test(command),
});
// The child gets the signal as well, since it shares the terminal; wait for it to stop before removing its files.
/** @type {NodeJS.Signals[]} */
const forwarded = ['SIGINT', 'SIGTERM'];
for (const signal of forwarded) process.on(signal, () => child.kill(signal));

child.on('error', (err) => {
  remove();
  console.error(`error: cannot run ${command}: ${err.message}`);
  process.exit(1);
});
child.on('close', (code, signal) => {
  remove();
  process.exit(code ?? (signal ? 128 + (signal === 'SIGINT' ? 2 : 15) : 1));
});
