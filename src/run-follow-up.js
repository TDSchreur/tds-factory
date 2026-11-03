/** @import { FollowUp, Run } from './run-record.js' */
import { oneOf } from './narrow.js';
import { changeRunFlow } from './run-folder.js';
import { ownWorktreesFlow, worktreeStateFlow } from './worktrees.js';
import { immediate, runSync } from './git.js';
/** @import { Step } from './git.js' */
import { extraLoops, loops, loopCap, reworkInProgress, validId } from './run-record.js';
import { clearEvidence } from './evidence.js';
import { moveVisit } from './run-metrics.js';
import { can, providerFor, providerWith } from './pr-provider.js';

// The provider of a PR link, or the error Follow-up has always given for a link it cannot read.
/** @param {string | undefined} url */
function providerOrThrow(url) {
  const provider = typeof url === 'string' && providerFor(url);
  if (!provider) throw new Error('Follow-up needs the URL of a PR on a supported host');
  if (!can(url, 'strictViewFlow')) throw new Error(`Follow-up does not support ${provider.title} yet`);
  return { pr: url, provider: providerWith(url, 'strictViewFlow', 'observeFlow') };
}

// One scope per Rework: the kind of finding the agent works on.
export const FOLLOW_UP_SCOPES = /** @type {const} */ (['conflicts', 'checks', 'comments']);
/** @typedef {typeof FOLLOW_UP_SCOPES[number]} FollowUpScope */
const ALLOWED = `${FOLLOW_UP_SCOPES.slice(0, -1).join(', ')} or ${FOLLOW_UP_SCOPES.at(-1)}`;
const FLAG = `--scope ${FOLLOW_UP_SCOPES.join('|')}`;

// The scopes of the findings in an observation, in the order of FOLLOW_UP_SCOPES.
/** @param {FollowUp} snapshot @returns {FollowUpScope[]} */
const scopesWithFindings = (snapshot) =>
  FOLLOW_UP_SCOPES.filter((scope) =>
    scope === 'conflicts'
      ? snapshot.conflicts === true
      : scope === 'checks'
        ? snapshot.failures.length > 0
        : snapshot.threads.length > 0,
  );

/**
 * Observes the PR and, for the findings of the chosen scope only, sends the Run back to Build as a Rework. The change of the record, as a flow so the Dashboard can run it without blocking (ADR 0030).
 * @param {string} projectDir
 * @param {string} runId
 * @param {Run} old
 * @param {string | undefined} scope
 * @returns {Generator<Step, { record: Run, result: string }, any>}
 */
function* followUpChange(projectDir, runId, old, scope) {
  const id = runId;
  /** @type {string} */
  let result;
  if (!oneOf(['finish', 'follow-up'], old.stage) || !oneOf(['running', 'done'], old.status))
    throw new Error('Follow-up needs a running or done Run in Finish or Follow-up');
  const { pr, provider } = providerOrThrow(old.pr);
  // The link of every host ends in the PR number; the adapter has already matched the whole link.
  const number = Number(pr.split('/').at(-1));
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error('Follow-up needs the URL of a PR on a supported host');
  const state = yield* provider.strictViewFlow(pr, projectDir);
  if (state.state === 'CLOSED') throw new Error('the PR is closed without a merge');
  if (state.state === 'MERGED') {
    const record = old.stage === 'follow-up' ? old : moveVisit(old, 'follow-up');
    result = 'PR merged; Follow-up is Done';
    return {
      result,
      record: {
        ...moveVisit(record, null),
        stage: 'follow-up',
        status: 'done',
        activity: result,
        updated: new Date().toISOString(),
      },
    };
  }
  const own = (yield* ownWorktreesFlow(projectDir)).get(runId);
  if (!own?.safe || own.branch !== id || old.worktree !== own.dir)
    throw new Error(
      'the registered Run worktree is missing or invalid, for example because it was cleaned; start a new Run for further changes',
    );
  const before = yield* worktreeStateFlow(old);
  if (before.dirty)
    throw new Error(
      'Follow-up needs a clean Run worktree at the PR head: the worktree has uncommitted changes; commit or discard them, then try again',
    );
  if (before.head !== state.headRefOid)
    throw new Error(
      'Follow-up needs a clean Run worktree at the PR head: the worktree head differs from the PR head; push the Run commits or pull the PR commits into the worktree, then try again',
    );
  const snapshot = yield* provider.observeFlow(pr, before.head, projectDir);
  const after = yield* worktreeStateFlow(old),
    latest = yield* provider.strictViewFlow(pr, projectDir);
  const registered = (yield* ownWorktreesFlow(projectDir)).get(runId);
  if (
    !registered?.safe ||
    registered.branch !== id ||
    registered.dir !== own.dir ||
    after.dirty ||
    after.head !== before.head ||
    latest.state !== 'OPEN' ||
    latest.headRefOid !== before.head
  )
    throw new Error('the PR or Run worktree changed during Follow-up');
  let record = old.stage === 'follow-up' && old.status === 'running' ? old : moveVisit(old, 'follow-up');
  record = {
    ...record,
    stage: 'follow-up',
    status: 'running',
    waiting_on_human: false,
    waiting_reason: '',
    status_reason: '',
    follow_up: snapshot,
  };
  const found = scopesWithFindings(snapshot);
  if (scope === undefined && found.length)
    throw new Error(`Follow-up found ${found.join(', ')}; choose what to work on with ${FLAG} (one scope per Rework)`);
  if (scope !== undefined && found.includes(/** @type {FollowUpScope} */ (scope))) {
    if (loops(record) >= loopCap(record)) {
      record = { ...record, follow_up: { ...snapshot, scope: /** @type {FollowUpScope} */ (scope) } };
      result = `Check loop limit of ${loopCap(record)} reached; Follow-up scope retained`;
    } else {
      record = clearEvidence({
        ...moveVisit({ ...record, follow_up: { ...snapshot, scope: /** @type {FollowUpScope} */ (scope) } }, 'build'),
        stage: 'build',
        check_loops: loops(record) + 1,
      });
      result = `Follow-up scoped Rework (${scope}): back to Build`;
    }
  } else if (scope !== undefined)
    result = `Follow-up: no ${scope} findings${found.length ? `; ${found.join(', ')} remain in the snapshot` : ''}`;
  else result = snapshot.pending ? 'Follow-up: CI pending' : 'Follow-up: no actionable feedback';
  return { result, record: { ...record, activity: result, updated: new Date().toISOString() } };
}

/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {{ scope?: string }} [options] `scope` is required when the observation has findings.
 * @returns {Generator<Step, string | undefined, any>}
 */
export function* followUpRunFlow(projectDir, id, { scope } = {}) {
  if (!validId(id)) throw new Error('invalid Run id');
  if (scope !== undefined && !oneOf(FOLLOW_UP_SCOPES, scope))
    throw new Error(`invalid Follow-up scope "${scope}": use ${ALLOWED}`);
  /** @type {string | undefined} */
  let result;
  yield* changeRunFlow(projectDir, id, function* (old) {
    const change = yield* followUpChange(projectDir, id, old, scope);
    result = change.result;
    return change.record;
  });
  return result;
}
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {{ scope?: string }} [options] `scope` is required when the observation has findings.
 */
export const followUpRun = (projectDir, id, options) => runSync(followUpRunFlow(projectDir, id, options));

export const FIX_WAITING_REASON = 'Follow-up Rework ready for an agent';
// The Dashboard's Fix (ADR 0034): a scoped Follow-up and, in the same Run lock, the wait for an agent. `updated` is the record time the user saw.
// With `grant` at the Check loop limit the extra loop is raised first and written on its own, so it stands when the Fix is then refused (ADR 0024).
// Returns what Follow-up did and whether a Rework started.
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {{ scope?: string, updated?: string, grant?: boolean }} [options]
 * @returns {Generator<Step, { started: boolean, result: string }, any>}
 */
export function* fixRunFlow(projectDir, id, { scope, updated, grant = false } = {}) {
  if (!validId(id)) throw new Error('invalid Run id');
  if (!oneOf(FOLLOW_UP_SCOPES, scope)) throw new Error(`invalid Follow-up scope "${scope}": use ${ALLOWED}`);
  if (updated === undefined) throw new Error('the request must name the Run record time you looked at');
  /** @param {Run} old */
  const check = (old) => {
    if (updated !== old.updated) throw new Error('the Run changed since you looked at it; reload and look again');
    if (reworkInProgress(old))
      throw new Error('a Follow-up Rework is already in progress; finish it in Build and Check first');
    const capped = loops(old) >= loopCap(old);
    if (grant && !capped) throw new Error(`the Check loop limit of ${loopCap(old)} is not reached`);
    if (!grant && capped)
      throw new Error(`the Check loop limit of ${loopCap(old)} is reached; grant an extra loop to fix it`);
  };
  if (grant)
    yield* changeRunFlow(projectDir, id, function* (old) {
      check(old);
      return yield* immediate({
        ...old,
        extra_loops: extraLoops(old) + 1,
        activity: 'The user granted an extra Check loop on the Dashboard and started a Fix',
        updated: new Date().toISOString(),
      });
    });
  /** @type {{ started: boolean, result: string }} */
  let outcome = { started: false, result: '' };
  yield* changeRunFlow(projectDir, id, function* (old) {
    // After a grant the record time moved on; the user's look was checked with the grant.
    if (!grant) check(old);
    else if (reworkInProgress(old)) throw new Error('a Follow-up Rework is already in progress');
    const { record, result } = yield* followUpChange(projectDir, id, old, scope);
    const started = record.stage === 'build';
    outcome = { started, result };
    return started
      ? { ...record, status: 'waiting', waiting_on_human: false, waiting_reason: FIX_WAITING_REASON }
      : record;
  });
  return outcome;
}
