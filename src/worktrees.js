// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { originDefaultBranch } from './origin.js';
import { validId } from './run-record.js';

// Fetches origin's default branch and returns the commit it points at, without touching any local ref.
/** @param {string} dir */
export function fetchOriginDefault(dir) {
  /** @param {...string} args */
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  const { branch, error } = originDefaultBranch(dir);
  if (!branch) throw new Error(`cannot determine origin default branch: ${error}`);
  const fetchRef = `refs/tds-factory/fetch/${randomUUID()}`;
  const fetched = git('fetch', '--no-write-fetch-head', 'origin', `+refs/heads/${branch}:${fetchRef}`);
  if (fetched.status !== 0) throw new Error(`cannot fetch origin default branch: ${fetched.stderr.trim()}`);
  const commit = git('rev-parse', '--verify', `${fetchRef}^{commit}`);
  git('update-ref', '-d', fetchRef);
  if (commit.status !== 0) throw new Error('cannot resolve fetched origin default branch');
  return commit.stdout.trim();
}

// Why the Run branch would not merge cleanly into origin's default branch: empty when it would.
/**
 * @param {string} projectDir
 * @param {Record<string, any>} record
 */
export function mergeProblem(projectDir, record) {
  const base = fetchOriginDefault(projectDir);
  const merged = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', base, 'HEAD'], {
    cwd: record.worktree,
    encoding: 'utf8',
  });
  if (merged.status === 0) return '';
  if (merged.status !== 1)
    throw new Error(
      `cannot check the merge into origin (git merge-tree --write-tree needs git 2.38 or later): ${merged.stderr.trim()}`,
    );
  // The first line is the tree id, then the conflicted files, then a blank line and git's messages.
  const files = merged.stdout.split('\n\n')[0].split('\n').slice(1).filter(Boolean);
  return `the branch conflicts with origin's default branch${files.length ? ` in ${files.join(', ')}` : ''}; run \`tds-factory run sync\` and resolve it`;
}

// The code revision a Run's Evidence is about: the worktree's head, and whether it has uncommitted changes.
/** @param {Record<string, any>} record */
export function worktreeState(record) {
  if (!record.worktree || !fs.existsSync(record.worktree)) throw new Error('the Run worktree is missing');
  /** @param {...string} args */
  const git = (...args) => spawnSync('git', args, { cwd: record.worktree, encoding: 'utf8' });
  const head = git('rev-parse', 'HEAD'),
    status = git('status', '--porcelain');
  if (head.status !== 0 || status.status !== 0)
    throw new Error(`cannot read the Run worktree: ${(head.stderr || status.stderr).trim()}`);
  return { head: head.stdout.trim(), dirty: status.stdout.trim() !== '' };
}

// Only worktrees at the store's own paths can be recovered.
/** @param {string} projectDir */
export function ownWorktrees(projectDir) {
  const base = path.join(projectDir, '.factory', 'worktrees');
  if (fs.existsSync(base) && fs.realpathSync(base) !== base)
    throw new Error('Run worktree storage must not be symlinked');
  const listed = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: projectDir, encoding: 'utf8' });
  if (listed.status !== 0) throw new Error('cannot list git worktrees');
  const entries = new Map();
  for (const part of listed.stdout.split('\n\n')) {
    const dir = /^worktree (.+)$/m.exec(part)?.[1];
    const branch = /^branch refs\/heads\/(.+)$/m.exec(part)?.[1];
    if (!dir || path.dirname(dir) !== base) continue;
    const id = path.basename(dir);
    if (!validId(id)) continue;
    const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
    const safe = !!stat && stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(dir) === dir;
    entries.set(id, { dir, branch, head: /^HEAD (.+)$/m.exec(part)?.[1], missing: !stat, safe });
  }
  return entries;
}

// Uncommitted work in a worktree, as Git reports it with untracked files shown and submodules inspected; undefined when Git cannot say.
/** @param {string} dir */
export const worktreeChanges = (dir) => {
  const status = spawnSync(
    'git',
    [
      '-c',
      'status.showUntrackedFiles=normal',
      '-c',
      'core.fsmonitor=false',
      'status',
      '--porcelain',
      '--ignore-submodules=none',
    ],
    { cwd: dir, encoding: 'utf8' },
  );
  return status.status === 0 ? status.stdout.trim() : undefined;
};

// A linked worktree keeps its submodules' repositories in its own git folder, so `git worktree remove --force` deletes them.
// Commits that no remote has and stashes live only there; undefined when Git cannot say.
/** @param {string} dir */
export const submoduleLocalWork = (dir) => {
  const out = spawnSync(
    'git',
    [
      'submodule',
      'foreach',
      '--recursive',
      '--quiet',
      'git log --branches --tags HEAD --not --remotes --oneline; git stash list',
    ],
    { cwd: dir, encoding: 'utf8' },
  );
  return out.status === 0 ? out.stdout.trim() : undefined;
};
