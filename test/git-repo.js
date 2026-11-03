import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Every folder this helper makes is removed when the test process exits, so repositories never pile up in the temp directory.
/** @type {string[]} */
const made = [];
process.on('exit', () => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
/** @param {string} prefix */
export function tempDir(prefix) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

// Git settings injected through the environment (GIT_CONFIG_COUNT and its KEY_n and VALUE_n, as some agent hosts and CI setups do) override the repository's own config, for example core.fsmonitor, so a test would give another result there than on a developer's machine.
for (const name of Object.keys(process.env))
  if (name === 'GIT_CONFIG_COUNT' || name === 'GIT_CONFIG_PARAMETERS' || /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name))
    delete process.env[name];

if (!process.env.TDS_FACTORY_CONFIG_DIR) process.env.TDS_FACTORY_CONFIG_DIR = tempDir('factory-config-');

/**
 * @param {string} cwd
 * @param {...string} args
 * @returns {string} The trimmed output of git.
 */
export const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();

// A real git repository with one commit on `main`.
export function repo() {
  const main = tempDir('git-repo-');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(main, 'remote', 'add', 'origin', main);
  return main;
}

// A linked worktree of `main`, on branch `side`.
/** @param {string} main The path of the main repository. */
export function linked(main) {
  const dir = join(tempDir('git-repo-linked-'), 'wt');
  git(main, 'worktree', 'add', '-q', '-b', 'side', dir);
  return dir;
}
