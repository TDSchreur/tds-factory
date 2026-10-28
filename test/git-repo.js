import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();

// A real git repository with one commit on `main`.
export function repo() {
  const main = realpathSync(mkdtempSync(join(tmpdir(), 'git-repo-')));
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(main, 'remote', 'add', 'origin', main);
  return main;
}

// A linked worktree of `main`, on branch `side`.
export function linked(main) {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'git-repo-linked-'))), 'wt');
  git(main, 'worktree', 'add', '-q', '-b', 'side', dir);
  return dir;
}
