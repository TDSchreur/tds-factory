import fs from 'node:fs';
import path from 'node:path';
import { git as runGit, gitStep, callStep, runSync } from './git.js';
/** @import { Step } from './git.js' */
/**
 * @typedef {{ state: string, head?: string }} PrInfo
 * @typedef {(url: string) => PrInfo | undefined} SyncPrLookup What the CLI and Doctor use.
 * @typedef {(url: string) => PrInfo | undefined | Promise<PrInfo | undefined>} PrLookup A lookup may answer at once or later; the Dashboard's clean awaits it.
 */
import { codeOf, messageOf, oneOf } from './narrow.js';
import { statuses, validId } from './run-record.js';
import { providerFor } from './pr-provider.js';
import { runRoot, withRunLockFlow, readRun, runIds, mainCheckout } from './run-folder.js';
import { ownWorktrees, ownWorktreesFlow, worktreeChangesFlow, submoduleLocalWorkFlow } from './worktrees.js';

// Deletes a readable Run in the project's own, unlinked storage.
/**
 * @param {string} projectDir
 * @param {string} id
 * @param {(reason: string) => void} [why]
 * @param {{ discardChanges?: boolean, doneOnly?: boolean }} [options]
 * @returns {Generator<Step, string, any>}
 */
export function* removeRunFlow(projectDir, id, why = () => {}, { discardChanges = false, doneOnly = false } = {}) {
  if (!id || id === '.' || id === '..' || /[/\\\0]/.test(id)) return 'invalid';
  const project = fs.realpathSync(projectDir);
  const factory = path.join(project, '.factory');
  const root = path.join(factory, 'runs');
  const dir = path.join(root, id);
  try {
    if (fs.realpathSync(factory) !== factory || fs.realpathSync(root) !== root) return 'not-allowed';
    return yield* withRunLockFlow(root, id, function* () {
      if (fs.realpathSync(dir) !== dir || fs.lstatSync(path.join(dir, 'run.json')).isSymbolicLink())
        return 'not-allowed';
      const record = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
      if (
        !record ||
        !oneOf(statuses, record.status) ||
        (doneOnly === true && !oneOf(['done', 'abandoned'], record.status))
      )
        return 'not-allowed';
      // Only a worktree this store created is removed; an adopted one belongs to the user.
      const own = path.join(factory, 'worktrees', id);
      if (record.worktree === own) {
        const treeRoot = path.dirname(own);
        /** @param {string} p */
        const lstat = (p) => {
          try {
            return fs.lstatSync(p);
          } catch (err) {
            if (codeOf(err) === 'ENOENT') return null;
            throw err;
          }
        };
        const rootStat = lstat(treeRoot),
          ownStat = lstat(own);
        if (rootStat?.isSymbolicLink() || ownStat?.isSymbolicLink() || (ownStat && fs.realpathSync(own) !== own)) {
          why('the Run worktree storage is linked');
          return 'worktree-refused';
        }
        if (ownStat) {
          // Pin untracked file visibility and inspect submodules before Git's required force removal.
          const changes = yield* worktreeChangesFlow(own);
          if (changes && discardChanges !== true) {
            why('the Run worktree has uncommitted changes');
            return 'dirty-worktree';
          }
          /** @type {{ status: number | null, stderr: string, error?: Error }} */
          const removal =
            changes !== undefined
              ? yield* gitStep(project, ['worktree', 'remove', '--force', own])
              : { status: 1, stderr: 'cannot read the Run worktree status' };
          if (removal.status !== 0) {
            why('git could not remove the Run worktree: ' + (removal.stderr || removal.error?.message || '').trim());
            return 'worktree-refused';
          }
        }
      }
      fs.rmSync(dir, { recursive: true });
      return 'deleted';
    });
  } catch (err) {
    if (codeOf(err) === 'ENOENT') return 'not-found';
    if (codeOf(err) === 'EEXIST' || err instanceof SyntaxError) return 'not-allowed';
    throw err;
  }
}
/**
 * @param {string} projectDir
 * @param {string} id
 * @param {(reason: string) => void} [why]
 * @param {{ discardChanges?: boolean, doneOnly?: boolean }} [options]
 */
export const removeRun = (projectDir, id, why, options) => runSync(removeRunFlow(projectDir, id, why, options));

// The answer of a provider's view as a PrInfo; undefined when its state is not a string. Shared by the sync and async lookups.
/** @param {{ state?: unknown, headRefOid?: string }} view @returns {PrInfo | undefined} */
const prInfoOf = ({ state, headRefOid }) => (typeof state === 'string' ? { state, head: headRefOid } : undefined);

// State and head commit of a PR as its host reports them; undefined when the host cannot say or no provider handles the link.
/** @type {(url: string) => PrInfo | undefined} */
function ghPrInfo(url) {
  const provider = providerFor(url);
  if (!provider) return undefined;
  try {
    return prInfoOf(provider.view(url));
  } catch {
    // A PR that cannot be looked up is unknown; the caller then keeps the Run's worktree.
    return undefined;
  }
}
// The same without blocking the event loop, for the Dashboard; undefined too when the provider has no viewAsync.
/** @type {(url: string) => Promise<PrInfo | undefined>} */
export async function ghPrInfoAsync(url) {
  const provider = providerFor(url);
  if (!provider?.viewAsync) return undefined;
  try {
    return prInfoOf(await provider.viewAsync(url));
  } catch {
    // Unknown, like the sync lookup: the caller then keeps the Run's worktree.
    return undefined;
  }
}

// Removes the worktree and branch of a Run whose PR is merged, and keeps its record. Anything unclear leaves everything in place.
/**
 * @param {string} projectDir
 * @param {string} callerDir
 * @param {string | undefined} rawId
 * @param {PrLookup} [prState]
 * @returns {Generator<Step, { id: string, outcome: string, reason?: string }, any>}
 */
export function* cleanRunFlow(projectDir, callerDir, rawId, prState = ghPrInfo) {
  if (!validId(rawId)) throw new Error('invalid Run id');
  const id = rawId;
  /** @param {string} reason */
  const kept = (reason) => ({ id, outcome: 'kept', reason });
  const { root, record } = readRun(projectDir, id);
  const own = (yield* ownWorktreesFlow(projectDir)).get(id);
  /** @param {...string} args */
  const git = (...args) => gitStep(projectDir, args);
  const tip = yield* git('rev-parse', '--verify', '-q', `refs/heads/${id}`);
  const head = tip.status === 0 ? tip.stdout.trim() : undefined;
  if (!own && !head) return { id, outcome: 'already clean' };
  if (!record.pr) return kept('no PR recorded');
  if (record.status !== 'done') return kept('the Run is not done: finish it with run complete first');
  /** @param {string} dir */
  const inside = (dir) => {
    const rel = path.relative(dir, fs.realpathSync(callerDir));
    return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
  };
  if (own && !own.missing && inside(own.dir))
    return kept('run clean from the main checkout, not from inside the Run worktree');
  const pr = yield* callStep(() => prState(/** @type {string} */ (record.pr)));
  if (!pr) return kept('cannot read the PR state from its host');
  if (pr.state !== 'MERGED') return kept(`the PR is ${String(pr.state).toLowerCase()}, not merged`);
  if (head && head !== pr.head) {
    // "Update branch" on the host adds commits to the PR, so the local tip may be an ancestor of the merged head.
    if (!pr.head) return kept('the branch has commits that are not in the merged PR');
    const known = yield* git('cat-file', '-e', `${pr.head}^{commit}`);
    if (known.status !== 0) return kept('the merged PR head is not in this repository: fetch it, then run clean again');
    const ancestor = yield* git('merge-base', '--is-ancestor', head, pr.head);
    if (ancestor.status !== 0) return kept('the branch has commits that are not in the merged PR');
  }
  if (own && (!own.safe || own.branch !== id)) return kept('the Run worktree is not the one this store created');
  if (record.worktree !== path.join(projectDir, '.factory', 'worktrees', id))
    return kept('the Run record does not name the worktree this store created');
  if (own?.missing) return kept('the Run worktree is missing: inspect it with run repair');
  return yield* withRunLockFlow(root, id, function* () {
    // The lookup above can take seconds; a commit made meanwhile must keep the branch.
    const now = (yield* git('rev-parse', '--verify', '-q', `refs/heads/${id}`)).stdout.trim();
    if (head && now !== head) return kept('the branch has commits that are not in the merged PR');
    const listed = yield* git('worktree', 'list', '--porcelain');
    if (listed.status !== 0) return kept('cannot list the git worktrees');
    const elsewhere = listed.stdout
      .split('\n\n')
      .some(
        (part) =>
          part.split('\n').includes(`branch refs/heads/${id}`) &&
          !(own && part.startsWith('worktree ') && path.normalize(part.split('\n')[0].slice(9)) === own.dir),
      );
    if (elsewhere) return kept('the branch is checked out in another worktree');
    if (own) {
      const changes = yield* worktreeChangesFlow(own.dir);
      if (changes === undefined) return kept('cannot read the Run worktree status');
      if (changes) return kept('the Run worktree has uncommitted changes');
      const local = yield* submoduleLocalWorkFlow(own.dir);
      if (local === undefined) return kept('cannot read the submodules of the Run worktree');
      if (local) return kept('a submodule of the Run worktree has commits or stashes that exist nowhere else');
      // Git refuses a plain remove when a submodule is initialised; the status above already showed nothing to lose.
      const removal = yield* git('worktree', 'remove', '--force', own.dir);
      if (removal.status !== 0) return kept(`git could not remove the Run worktree: ${removal.stderr.trim()}`);
    }
    // A squash merge leaves the branch unmerged as far as git knows, so it goes only if its tip is still the merged PR head.
    if (head) {
      const deleted = yield* git('update-ref', '-d', `refs/heads/${id}`, head);
      if (deleted.status !== 0) return kept(`git could not delete the branch: ${deleted.stderr.trim()}`);
    }
    return { id, outcome: 'cleaned' };
  });
}
/**
 * @param {string} projectDir
 * @param {string} callerDir
 * @param {string | undefined} rawId
 * @param {SyncPrLookup} [prState]
 */
export const cleanRun = (projectDir, callerDir, rawId, prState) =>
  runSync(cleanRunFlow(projectDir, callerDir, rawId, prState));

// Ids of Runs whose PR is merged but whose worktree or branch is still there. Doctor reports them; nothing is changed.
/**
 * @param {string} callerDir
 * @param {SyncPrLookup} [prState]
 */
export function mergedLeftovers(callerDir, prState = ghPrInfo) {
  /** @type {string} */
  let projectDir, root, ids;
  /** @type {ReturnType<typeof ownWorktrees>} */
  let trees;
  try {
    projectDir = mainCheckout(callerDir).dir;
    root = runRoot(projectDir, false);
    trees = ownWorktrees(projectDir);
    ids = runIds(root);
  } catch {
    // Doctor's note about leftovers is optional; outside a Factory project there is nothing to list.
    return [];
  }
  /** @param {...string} args */
  const git = (...args) => runGit(projectDir, args);
  return ids.filter((id) => {
    try {
      const { record } = readRun(projectDir, id);
      const left = trees.has(id) || git('rev-parse', '--verify', '-q', `refs/heads/${id}`).status === 0;
      return left && record.status === 'done' && !!record.pr && prState(record.pr)?.state === 'MERGED';
    } catch {
      // A Run record that cannot be read is not reported as a leftover; Run inspect reports unreadable records.
      return false;
    }
  });
}

// Cleans every Run that records a PR; a Run folder that cannot be read is reported and skipped.
/**
 * @param {string} projectDir
 * @param {string} callerDir
 * @param {SyncPrLookup} [prState]
 */
export function cleanAll(projectDir, callerDir, prState) {
  if (!fs.existsSync(path.join(projectDir, '.factory', 'runs'))) return [];
  const root = runRoot(projectDir, false);
  return runIds(root).flatMap((name) => {
    try {
      return readRun(projectDir, name).record.pr ? [cleanRun(projectDir, callerDir, name, prState)] : [];
    } catch (err) {
      return [{ id: name, outcome: 'kept', reason: `cannot read the Run: ${messageOf(err)}` }];
    }
  });
}
