import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Every folder this helper makes is removed when the test process exits, so repositories never pile up in the temp directory.
const made = [];
process.on('exit', () => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
function tempDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

export const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();

// A real git repository with one commit on `main`.
export function repo() {
  const main = tempDir('git-repo-');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(main, 'remote', 'add', 'origin', main);
  return main;
}

// A linked worktree of `main`, on branch `side`.
export function linked(main) {
  const dir = join(tempDir('git-repo-linked-'), 'wt');
  git(main, 'worktree', 'add', '-q', '-b', 'side', dir);
  return dir;
}
