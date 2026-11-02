// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { git as runGit, gitStep, runSync } from './git.js';
/** @import { Step } from './git.js' */
import { originDefaultBranchFlow } from './origin.js';
/** @import { Run } from './run-record.js' */
import { validId } from './run-record.js';

// Fetches origin's default branch and returns the commit it points at, without touching any local ref.
/**
 * @param {string} dir
 * @returns {Generator<Step, string, any>}
 */
export function* fetchOriginDefaultFlow(dir) {
  /** @param {...string} args */
  const git = (...args) => gitStep(dir, args);
  const { branch, error } = yield* originDefaultBranchFlow(dir);
  if (!branch) throw new Error(`cannot determine origin default branch: ${error}`);
  const fetchRef = `refs/tds-factory/fetch/${randomUUID()}`;
  const fetched = yield* git('fetch', '--no-write-fetch-head', 'origin', `+refs/heads/${branch}:${fetchRef}`);
  if (fetched.status !== 0) throw new Error(`cannot fetch origin default branch: ${fetched.stderr.trim()}`);
  const commit = yield* git('rev-parse', '--verify', `${fetchRef}^{commit}`);
  yield* git('update-ref', '-d', fetchRef);
  if (commit.status !== 0) throw new Error('cannot resolve fetched origin default branch');
  return commit.stdout.trim();
}
/** @param {string} dir */
export const fetchOriginDefault = (dir) => runSync(fetchOriginDefaultFlow(dir));

// Why the Run branch would not merge cleanly into origin's default branch: empty when it would.
/**
 * @param {string} projectDir
 * @param {Run} record
 */
export function mergeProblem(projectDir, record) {
  const base = fetchOriginDefault(projectDir);
  const merged = runGit(record.worktree, ['merge-tree', '--write-tree', '--name-only', base, 'HEAD']);
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
/**
 * @param {Pick<Run, 'worktree'>} record
 * @returns {Generator<Step, { head: string, dirty: boolean }, any>}
 */
export function* worktreeStateFlow(record) {
  if (!record.worktree || !fs.existsSync(record.worktree)) throw new Error('the Run worktree is missing');
  /** @param {...string} args */
  const git = (...args) => gitStep(record.worktree, args);
  const head = yield* git('rev-parse', 'HEAD'),
    status = yield* git('status', '--porcelain');
  if (head.status !== 0 || status.status !== 0)
    throw new Error(`cannot read the Run worktree: ${(head.stderr || status.stderr).trim()}`);
  return { head: head.stdout.trim(), dirty: status.stdout.trim() !== '' };
}
/** @param {Pick<Run, 'worktree'>} record */
export const worktreeState = (record) => runSync(worktreeStateFlow(record));

// Only worktrees at the store's own paths can be recovered.
/**
 * @param {string} projectDir
 * @returns {Generator<Step, Map<string, { dir: string, branch: string | undefined, head: string | undefined, missing: boolean, safe: boolean }>, any>}
 */
export function* ownWorktreesFlow(projectDir) {
  const base = path.join(projectDir, '.factory', 'worktrees');
  if (fs.existsSync(base) && fs.realpathSync(base) !== base)
    throw new Error('Run worktree storage must not be symlinked');
  const listed = yield* gitStep(projectDir, ['worktree', 'list', '--porcelain']);
  if (listed.status !== 0) throw new Error('cannot list git worktrees');
  /** @type {Map<string, { dir: string, branch: string | undefined, head: string | undefined, missing: boolean, safe: boolean }>} */
  const entries = new Map();
  for (const part of listed.stdout.split('\n\n')) {
    // Git prints forward slashes on Windows.
    const dir = /^worktree (.+)$/m.exec(part)?.[1]?.replace(/\r$/, '');
    const branch = /^branch refs\/heads\/(.+)$/m.exec(part)?.[1];
    if (!dir) continue;
    const own = path.normalize(dir);
    if (path.dirname(own) !== base) continue;
    const id = path.basename(own);
    if (!validId(id)) continue;
    const stat = fs.lstatSync(own, { throwIfNoEntry: false });
    const safe = !!stat && stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(own) === own;
    entries.set(id, { dir: own, branch, head: /^HEAD (.+)$/m.exec(part)?.[1], missing: !stat, safe });
  }
  return entries;
}
/** @param {string} projectDir */
export const ownWorktrees = (projectDir) => runSync(ownWorktreesFlow(projectDir));

// Uncommitted work in a worktree, as Git reports it with untracked files shown and submodules inspected; undefined when Git cannot say.
/**
 * @param {string} dir
 * @returns {Generator<Step, string | undefined, any>}
 */
export function* worktreeChangesFlow(dir) {
  const status = yield* gitStep(dir, [
    '-c',
    'status.showUntrackedFiles=normal',
    '-c',
    'core.fsmonitor=false',
    'status',
    '--porcelain',
    '--ignore-submodules=none',
  ]);
  return status.status === 0 ? status.stdout.trim() : undefined;
}
/** @param {string} dir */
export const worktreeChanges = (dir) => runSync(worktreeChangesFlow(dir));

// A linked worktree keeps its submodules' repositories in its own git folder, so `git worktree remove --force` deletes them.
// Commits that no remote has and stashes live only there; undefined when Git cannot say.
/**
 * @param {string} dir
 * @returns {Generator<Step, string | undefined, any>}
 */
export function* submoduleLocalWorkFlow(dir) {
  const out = yield* gitStep(dir, [
    'submodule',
    'foreach',
    '--recursive',
    '--quiet',
    'git log --branches --tags HEAD --not --remotes --oneline; git stash list',
  ]);
  return out.status === 0 ? out.stdout.trim() : undefined;
}
/** @param {string} dir */
export const submoduleLocalWork = (dir) => runSync(submoduleLocalWorkFlow(dir));
