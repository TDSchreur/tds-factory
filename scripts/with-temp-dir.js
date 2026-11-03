// @ts-check
// Runs a command with its own temporary directory and removes that directory afterwards.
// Usage: node scripts/with-temp-dir.js <command> [args...]
// The tests and evals make many folders in the temp directory and none of them removes its own. Pointing
// TMPDIR (macOS, Linux) and TMP and TEMP (Windows) at one folder per run turns "clean up after every test"
// into "remove one folder", also when the command fails or is interrupted.
import { mkdirSync, mkdtempSync, rmSync, realpathSync, writeFileSync } from 'node:fs';
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
/** @type {Record<string, string | undefined>} */
const env = { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir, TDS_FACTORY_CONFIG_DIR: join(dir, 'factory-config') };
// The tests set up their own home folders; a developer's CLAUDE_CONFIG_DIR must not leak into them.
delete env.CLAUDE_CONFIG_DIR;
if (process.platform === 'win32') {
  // Many tests use the POSIX commands true and false as their Verify command, and cmd.exe has neither.
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'true.cmd'), '@exit /b 0\r\n');
  writeFileSync(join(bin, 'false.cmd'), '@exit /b 1\r\n');
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'Path';
  env[key] = `${bin};${env[key] ?? ''}`;
}
// npm and tds-factory are .cmd shims on Windows, which spawn only runs through a shell.
const child = spawn(command, args, {
  stdio: 'inherit',
  env,
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
