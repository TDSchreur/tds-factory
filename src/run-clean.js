import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { statuses } from './run-record.js';
import { runRoot, withRunLock, readRun, runIds, mainCheckout } from './run-folder.js';
import { ownWorktrees, worktreeChanges, submoduleLocalWork } from './worktrees.js';

// Deletes a readable Run in the project's own, unlinked storage.
export function removeRun(projectDir, id, why = () => {}, { discardChanges = false, doneOnly = false } = {}) {
  if (!id || id === '.' || id === '..' || /[\/\\\0]/.test(id)) return 'invalid';
  const project = fs.realpathSync(projectDir);
  const factory = path.join(project, '.factory');
  const root = path.join(factory, 'runs');
  const dir = path.join(root, id);
  try {
    if (fs.realpathSync(factory) !== factory || fs.realpathSync(root) !== root) return 'not-allowed';
    return withRunLock(root, id, () => {
      if (fs.realpathSync(dir) !== dir || fs.lstatSync(path.join(dir, 'run.json')).isSymbolicLink()) return 'not-allowed';
      const record = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
      if (!record || !statuses.includes(record.status) || (doneOnly === true && !['done', 'abandoned'].includes(record.status))) return 'not-allowed';
      // Only a worktree this store created is removed; an adopted one belongs to the user.
      const own = path.join(factory, 'worktrees', id);
      if (record.worktree === own) {
        const treeRoot = path.dirname(own);
        const lstat = (p) => { try { return fs.lstatSync(p); } catch (err) { if (err.code === 'ENOENT') return null; throw err; } };
        const rootStat = lstat(treeRoot), ownStat = lstat(own);
        if (rootStat?.isSymbolicLink() || ownStat?.isSymbolicLink() || (ownStat && fs.realpathSync(own) !== own)) {
          why('the Run worktree storage is linked'); return 'worktree-refused';
        }
        if (ownStat) {
          // Pin untracked file visibility and inspect submodules before Git's required force removal.
          const changes = worktreeChanges(own);
          if (changes && discardChanges !== true) { why('the Run worktree has uncommitted changes'); return 'dirty-worktree'; }
          const removal = changes !== undefined ? spawnSync('git', ['worktree', 'remove', '--force', own], { cwd: project, encoding: 'utf8' }) : { status: 1, stderr: 'cannot read the Run worktree status' };
          if (removal.status !== 0) { why('git could not remove the Run worktree: ' + (removal.stderr || removal.error?.message || '').trim()); return 'worktree-refused'; }
        }
      }
      fs.rmSync(dir, { recursive: true });
      return 'deleted';
    });
  } catch (err) {
    if (err.code === 'ENOENT') return 'not-found';
    if (err.code === 'EEXIST' || err instanceof SyntaxError) return 'not-allowed';
    throw err;
  }
}

// State and head commit of a PR as GitHub reports them; undefined when gh cannot say. Only a GitHub PR link is passed to gh.
export function ghPrInfo(url) {
  if (typeof url !== 'string' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(url)) return undefined;
  const out = spawnSync('gh', ['pr', 'view', url, '--json', 'state,headRefOid'], { encoding: 'utf8', timeout: 10000 });
  if (out.status !== 0) return undefined;
  try {
    const { state, headRefOid } = JSON.parse(out.stdout);
    return typeof state === 'string' ? { state, head: headRefOid } : undefined;
  } catch { return undefined; }
}

// Removes the worktree and branch of a Run whose PR is merged, and keeps its record. Anything unclear leaves everything in place.
export function cleanRun(projectDir, callerDir, id, prState = ghPrInfo) {
  const kept = (reason) => ({ id, outcome: 'kept', reason });
  const { root, record } = readRun(projectDir, id);
  const own = ownWorktrees(projectDir).get(id);
  const git = (...args) => spawnSync('git', args, { cwd: projectDir, encoding: 'utf8' });
  const tip = git('rev-parse', '--verify', '-q', `refs/heads/${id}`);
  const head = tip.status === 0 ? tip.stdout.trim() : undefined;
  if (!own && !head) return { id, outcome: 'already clean' };
  if (!record.pr) return kept('no PR recorded');
  if (record.status !== 'done') return kept('the Run is not done: finish it with run complete first');
  const inside = (dir) => { const rel = path.relative(dir, fs.realpathSync(callerDir)); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
  if (own && !own.missing && inside(own.dir)) return kept('run clean from the main checkout, not from inside the Run worktree');
  const pr = prState(record.pr);
  if (!pr) return kept('cannot read the PR state from GitHub');
  if (pr.state !== 'MERGED') return kept(`the PR is ${String(pr.state).toLowerCase()}, not merged`);
  if (head && head !== pr.head) return kept('the branch has commits that are not in the merged PR');
  if (own && (!own.safe || own.branch !== id)) return kept('the Run worktree is not the one this store created');
  if (record.worktree !== path.join(projectDir, '.factory', 'worktrees', id)) return kept('the Run record does not name the worktree this store created');
  if (own?.missing) return kept('the Run worktree is missing: inspect it with run repair');
  return withRunLock(root, id, () => {
    // The lookup above can take seconds; a commit made meanwhile must keep the branch.
    const now = git('rev-parse', '--verify', '-q', `refs/heads/${id}`).stdout.trim();
    if (head && now !== head) return kept('the branch has commits that are not in the merged PR');
    const listed = git('worktree', 'list', '--porcelain');
    if (listed.status !== 0) return kept('cannot list the git worktrees');
    const elsewhere = listed.stdout.split('\n\n').some((part) => new RegExp(`^branch refs/heads/${id}$`, 'm').test(part) && !(own && part.startsWith(`worktree ${own.dir}\n`)));
    if (elsewhere) return kept('the branch is checked out in another worktree');
    if (own) {
      const changes = worktreeChanges(own.dir);
      if (changes === undefined) return kept('cannot read the Run worktree status');
      if (changes) return kept('the Run worktree has uncommitted changes');
      const local = submoduleLocalWork(own.dir);
      if (local === undefined) return kept('cannot read the submodules of the Run worktree');
      if (local) return kept('a submodule of the Run worktree has commits or stashes that exist nowhere else');
      // Git refuses a plain remove when a submodule is initialised; the status above already showed nothing to lose.
      const removal = git('worktree', 'remove', '--force', own.dir);
      if (removal.status !== 0) return kept(`git could not remove the Run worktree: ${removal.stderr.trim()}`);
    }
    // A squash merge leaves the branch unmerged as far as git knows, so it goes only if its tip is still the merged PR head.
    if (head) {
      const deleted = git('update-ref', '-d', `refs/heads/${id}`, head);
      if (deleted.status !== 0) return kept(`git could not delete the branch: ${deleted.stderr.trim()}`);
    }
    return { id, outcome: 'cleaned' };
  });
}

// Ids of Runs whose PR is merged but whose worktree or branch is still there. Doctor reports them; nothing is changed.
export function mergedLeftovers(callerDir, prState = ghPrInfo) {
  let projectDir, root, trees, ids;
  try { projectDir = mainCheckout(callerDir).dir; root = runRoot(projectDir, false); trees = ownWorktrees(projectDir); ids = runIds(root); } catch { return []; }
  const git = (...args) => spawnSync('git', args, { cwd: projectDir, encoding: 'utf8' });
  return ids.filter((id) => {
    try {
      const { record } = readRun(projectDir, id);
      const left = trees.has(id) || git('rev-parse', '--verify', '-q', `refs/heads/${id}`).status === 0;
      return left && record.status === 'done' && !!record.pr && prState(record.pr)?.state === 'MERGED';
    } catch { return false; }
  });
}

// Cleans every Run that records a PR; a Run folder that cannot be read is reported and skipped.
export function cleanAll(projectDir, callerDir, prState) {
  if (!fs.existsSync(path.join(projectDir, '.factory', 'runs'))) return [];
  const root = runRoot(projectDir, false);
  return runIds(root).flatMap((name) => {
    try { return readRun(projectDir, name).record.pr ? [cleanRun(projectDir, callerDir, name, prState)] : []; } catch (err) { return [{ id: name, outcome: 'kept', reason: `cannot read the Run: ${err.message}` }]; }
  });
}
