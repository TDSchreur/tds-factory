/** @import { Run } from './run-record.js' */
import { oneOf } from './narrow.js';
import { changeRun } from './run-folder.js';
import { ownWorktrees, worktreeState } from './worktrees.js';
import { loops, loopCap, validId } from './run-record.js';
import { clearEvidence } from './evidence.js';
import { moveVisit } from './run-metrics.js';
import { can, providerFor, providerWith } from './pr-provider.js';

// The provider of a PR link, or the error Follow-up has always given for a link it cannot read.
/** @param {string | undefined} url */
function providerOrThrow(url) {
  const provider = typeof url === 'string' && providerFor(url);
  if (!provider) throw new Error('Follow-up needs a GitHub PR URL');
  if (!can(url, 'strictView')) throw new Error(`Follow-up does not support ${provider.title} yet`);
  return { pr: url, provider: providerWith(url, 'strictView', 'observe') };
}

/**
 * @param {string} projectDir
 * @param {string | undefined} id
 */
export function followUpRun(projectDir, id) {
  if (!validId(id)) throw new Error('invalid Run id');
  const runId = id;
  /** @type {string | undefined} */
  let result;
  changeRun(projectDir, id, (old) => {
    if (!oneOf(['finish', 'follow-up'], old.stage) || !oneOf(['running', 'done'], old.status))
      throw new Error('Follow-up needs a running or done Run in Finish or Follow-up');
    const { pr, provider } = providerOrThrow(old.pr);
    const number = Number(pr.split('/').at(-1));
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Follow-up needs a GitHub PR URL');
    const state = provider.strictView(pr, projectDir);
    if (state.state === 'CLOSED') throw new Error('the PR is closed without a merge');
    if (state.state === 'MERGED') {
      const record = old.stage === 'follow-up' ? old : moveVisit(old, 'follow-up');
      result = 'PR merged; Follow-up is Done';
      return {
        ...moveVisit(record, null),
        stage: 'follow-up',
        status: 'done',
        activity: result,
        updated: new Date().toISOString(),
      };
    }
    const own = ownWorktrees(projectDir).get(runId);
    if (!own?.safe || own.branch !== id || old.worktree !== own.dir)
      throw new Error('the registered Run worktree is missing or invalid');
    const before = worktreeState(old);
    if (before.dirty || before.head !== state.headRefOid)
      throw new Error('Follow-up needs a clean Run worktree at the PR head');
    const snapshot = provider.observe(pr, before.head, projectDir);
    const after = worktreeState(old),
      latest = provider.strictView(pr, projectDir);
    const registered = ownWorktrees(projectDir).get(runId);
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
    if (snapshot.failures.length || snapshot.threads.length) {
      if (loops(record) >= loopCap(record))
        result = `Check loop limit of ${loopCap(record)} reached; Follow-up scope retained`;
      else {
        record = clearEvidence({ ...moveVisit(record, 'build'), stage: 'build', check_loops: loops(record) + 1 });
        result = 'Follow-up scoped Rework: back to Build';
      }
    } else result = snapshot.pending ? 'Follow-up: CI pending' : 'Follow-up: no actionable feedback';
    return { ...record, activity: result, updated: new Date().toISOString() };
  });
  return result;
}
