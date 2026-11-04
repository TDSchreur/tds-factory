import fs from 'node:fs';
import path from 'node:path';
import { git as runGit, gitStep, runSync } from './git.js';
/** @import { Step } from './git.js' */
/** @import { Run, Stage, Track } from './run-record.js' */
import { stages, isStage, stageIndex } from './flow.js';
import { codeOf, messageOf, oneOf } from './narrow.js';
import { loadProjectConfig, frozenSettings } from './project-config.js';
import {
  loopCap,
  extraLoops,
  tracks,
  trackOf,
  gated,
  validate,
  apply,
  write,
  checkCommands,
  fastCommandProblem,
  verifyCommandProblem,
  loops,
  isTrack,
} from './run-record.js';
import { runRoot, readRun, changeRun, changeRunning, changeRunningFlow } from './run-folder.js';
import { fetchOriginDefault, fetchOriginDefaultFlow, mergeProblem, worktreeStateFlow } from './worktrees.js';
import { finishProblems, clearEvidence } from './evidence.js';
import { runSize, overLimit, SIZE_WAIT_REASON } from './run-size.js';
import { appendEvent } from './run-events.js';
import { newMetrics, moveVisit, firstCheck, recordCauses, REWORK_CAUSES } from './run-metrics.js';

/**
 * @param {string} projectDir
 * @param {Partial<Run>} data
 */
export function startRun(projectDir, data) {
  validate(data);
  if (Object.keys(data).some((key) => !['title', 'agent', 'commands', 'fast_commands', 'conventions'].includes(key)))
    throw new Error('start accepts only title, agent, commands, fast_commands and conventions');
  if (!data.title || !data.agent || typeof data.commands !== 'string' || !Array.isArray(data.conventions))
    throw new Error('title, agent, commands and conventions are required');
  checkCommands(data.commands);
  const fastProblem = fastCommandProblem(data.fast_commands);
  if (fastProblem) throw new Error(fastProblem);
  /** @param {...string} args */
  const git = (...args) => runGit(projectDir, args);
  if (git('rev-parse', '--git-dir').status !== 0)
    throw new Error('a Run worktree needs a git repository: run git init first');
  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0)
    throw new Error('a Run worktree needs a git repository with at least one commit');
  const commit = fetchOriginDefault(projectDir);
  const slug =
    data.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'run';
  const base = `${new Date().toISOString().slice(0, 10)}-${slug}`;
  const root = runRoot(projectDir, true);
  const worktrees = path.join(path.dirname(root), 'worktrees');
  if (fs.existsSync(worktrees) && fs.realpathSync(worktrees) !== worktrees)
    throw new Error('Run storage must not be symlinked');
  let id = base,
    n = 2;
  while (true) {
    try {
      fs.mkdirSync(path.join(root, id));
    } catch (err) {
      if (codeOf(err) !== 'EEXIST') throw err;
      id = `${base}-${n++}`;
      continue;
    }
    // Branches outlive Run history, so a free folder name is not enough.
    if (git('rev-parse', '--verify', '-q', `refs/heads/${id}`).status !== 0) break;
    fs.rmdirSync(path.join(root, id));
    id = `${base}-${n++}`;
  }
  const now = new Date().toISOString();
  const worktree = path.join(worktrees, id);
  let created = false;
  try {
    const added = git('worktree', 'add', '-b', id, worktree, commit);
    if (added.status !== 0) throw new Error(`git worktree add failed: ${added.stderr.trim()}`);
    created = true;
    const { reviews: projectReviews, ...settings } = loadProjectConfig(worktree, data.agent);
    write(path.join(root, id), {
      ...apply(
        {
          // The type of a Run needs these two here; the second argument sets them again, after `data`, so `data` cannot override them.
          worktree,
          base_sha: commit,
          stage: 'define',
          status: 'running',
          waiting_on_human: false,
          waiting_reason: '',
          activity: 'Starting Define',
          tickets_total: 0,
          tickets_done: 0,
          check_loops: 0,
          created: now,
          last_seen: now,
        },
        { ...data, worktree, base_sha: commit },
      ),
      project_reviews: projectReviews,
      project_config: frozenSettings(settings),
      metrics: newMetrics(now),
    });
  } catch (err) {
    /** @type {string[]} */
    const failures = [];
    if (created) {
      const removed = git('worktree', 'remove', worktree);
      if (removed.status !== 0)
        failures.push(`worktree remains at ${worktree} and branch ${id} remains: ${removed.stderr.trim()}`);
      else {
        const deleted = git('update-ref', '-d', `refs/heads/${id}`, commit);
        if (deleted.status !== 0) failures.push(`branch ${id} remains: ${deleted.stderr.trim()}`);
      }
    }
    try {
      fs.rmdirSync(path.join(root, id));
    } catch (cleanup) {
      failures.push(`Run folder remains at ${path.join(root, id)}: ${messageOf(cleanup)}`);
    }
    if (failures.length) throw new Error(`${messageOf(err)}; rollback failed: ${failures.join('; ')}`, { cause: err });
    throw err;
  }
  return id;
}

/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {Partial<Run>} data
 */
export function updateRun(projectDir, id, data) {
  changeRun(projectDir, id, (old) => {
    validate(data);
    const locked = gated.find((key) => key in data);
    if (locked) throw new Error(`${locked} can only change through a Run transition`);
    // Evidence is only worth something if the command it came from cannot be swapped: set it once.
    if ('commands' in data && old.commands)
      throw new Error('the Verify command is already set; start a new Run to change it');
    if ('commands' in data) checkCommands(data.commands);
    if ('fast_commands' in data) throw new Error('the fast Verify command is set when the Run starts');
    if (data.status === 'done') throw new Error('a Run is completed with run complete');
    if ('status' in data && oneOf(['done', 'abandoned'], old.status))
      throw new Error(`a ${old.status} Run cannot change status`);
    const next = apply(old, ticketCount(old, data));
    if (growsOverTheLimit(projectDir, id, old, next)) return waitForSize(next);
    return data.status === 'abandoned' ? moveVisit(next, null) : next;
  });
}

// A Ticket finished in Build while Tickets remain and the size is over the limit: the user decides (ADR 0035). The measuring happens under the Run lock, in the same change.
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {Run} old
 * @param {Run} next
 * @param {import('./run-size.js').SizeOptions} [sizeOptions] for tests
 */
export function growsOverTheLimit(projectDir, id, old, next, sizeOptions) {
  if (next.stage !== 'build' || next.status !== 'running' || next.size_accepted) return false;
  const done = next.tickets_done ?? 0;
  if (done <= (old.tickets_done ?? 0) || done >= (next.tickets_total ?? 0)) return false;
  const size = runSize(projectDir, id, sizeOptions);
  return size !== undefined && overLimit(size);
}

/** @param {Run} record @returns {Run} */
const waitForSize = (record) => ({
  ...record,
  status: 'waiting',
  waiting_on_human: true,
  waiting_reason: SIZE_WAIT_REASON,
});

// The count of Tickets follows the Ticket links: a new list sets it, and a count that disagrees with the list is refused.
/**
 * @param {Run} old
 * @param {Record<string, any>} data
 * @returns {Record<string, any>}
 */
function ticketCount(old, data) {
  const list = 'tickets' in data ? data.tickets : old.tickets;
  const links = Array.isArray(list) ? list.length : 0;
  if ('tickets' in data || (links > 0 && 'tickets_total' in data)) {
    if ('tickets_total' in data && data.tickets_total !== links)
      throw new Error(`tickets_total (${data.tickets_total}) does not match the ${links} Tickets`);
    const done = data.tickets_done ?? old.tickets_done ?? 0;
    if ('tickets' in data && links < done) throw new Error(`tickets_done (${done}) is more than the ${links} Tickets`);
    return { ...data, tickets_total: links };
  }
  return data;
}

/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {string | undefined} to
 * @param {{ activity?: string }} [data]
 */
export function transitionRun(projectDir, id, to, data = {}) {
  changeRunning(projectDir, id, data, (old) => {
    // Runs recorded before the Prepare Stage was removed still say `prepare`; they are in Define.
    const from = old.stage === 'prepare' ? 'define' : old.stage;
    const next = stages[stageIndex(from ?? '') + 1];
    if (!isStage(to) || to !== next)
      throw new Error(`a Run in ${from} can only move to ${next ?? 'nowhere'}, not ${to}`);
    // Everything from Build on depends on verification, so an unusable command stops the Run here.
    const commandProblem = oneOf(['build', 'check', 'finish'], to) && verifyCommandProblem(old.commands);
    if (commandProblem)
      throw new Error(`${to[0].toUpperCase()}${to.slice(1)} needs a usable Verify command: ${commandProblem}`);
    if (to === 'build') {
      const missing = [!old.spec_link && 'a Spec link', !((old.tickets?.length ?? 0) > 0) && 'Tickets'].filter(Boolean);
      if (missing.length) throw new Error(`Build needs ${missing.join(' and ')}`);
    }
    if (oneOf(['build', 'check'], to) && trackOf(old) === 'fast' && old.tickets?.length !== 1) {
      throw new Error(`the Fast track needs exactly one Ticket, not ${old.tickets?.length ?? 0}`);
    }
    if (to === 'check' && (!old.tickets_total || old.tickets_done !== old.tickets_total))
      throw new Error(`Check needs every Ticket done (${old.tickets_done} of ${old.tickets_total})`);
    if (to === 'follow-up' && !old.pr) throw new Error('Follow-up needs a PR link');
    if (to === 'finish') {
      const problems = finishProblems(old);
      if (problems.length) throw new Error(`Finish needs a clean or Accepted Check: ${problems.join('; ')}`);
      const conflict = mergeProblem(projectDir, old);
      if (conflict) throw new Error(`Finish needs a branch that merges cleanly: ${conflict}`);
    }
    let record = old;
    if (to === 'finish') record = firstCheck(record, finishProblems({ ...old, accepted: undefined }).length === 0);
    record = moveVisit(record, to);
    record = { ...record, stage: to };
    return { record, activity: `Starting ${to}` };
  });
}

// The user's choice of Track, recorded only in Define; a record without one is a Full track Run.
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {string | undefined} value
 */
export function trackRun(projectDir, id, value) {
  if (!isTrack(value)) throw new Error(`track must be ${tracks.join(' or ')}`);
  changeRunning(projectDir, id, {}, (old) => {
    if (!oneOf(['define', 'prepare'], old.stage)) throw new Error('the track is chosen in Define');
    return { record: { ...old, track: value }, activity: `${value === 'fast' ? 'Fast' : 'Full'} track chosen` };
  });
}

/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {unknown} data
 * @returns {Generator<Step, void, any>}
 */
export function* acceptRunFlow(projectDir, id, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('data must be an object');
  if (Object.keys(data).some((key) => !['findings', 'decision'].includes(key)))
    throw new Error('accept takes only findings and decision');
  const { findings, decision } = /** @type {Record<string, unknown>} */ (data);
  if (typeof findings !== 'string' || !findings.trim()) throw new Error('accept needs findings');
  if (typeof decision !== 'string' || !decision.trim()) throw new Error('accept needs decision');
  yield* changeRunningFlow(projectDir, id, {}, function* (old) {
    if (old.stage !== 'check') throw new Error('only a Run in Check can accept its Check');
    const { head, dirty } = yield* worktreeStateFlow(old);
    if (dirty) throw new Error('cannot accept a Check while the Run worktree has uncommitted changes');
    return {
      record: {
        ...old,
        accepted: { findings, decision, head, at: new Date().toISOString() },
      },
      activity: 'Check accepted by the user',
    };
  });
}
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {unknown} data
 */
export const acceptRun = (projectDir, id, data) => runSync(acceptRunFlow(projectDir, id, data));
// Rebases onto origin's default branch. A changed head or recorded base makes Evidence stale, so it goes.
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {{ activity?: string }} [data]
 * @returns {Generator<Step, void, any>}
 */
export function* syncRunFlow(projectDir, id, data = {}) {
  yield* changeRunningFlow(projectDir, id, data, function* (old) {
    if (!oneOf(['build', 'check'], old.stage)) throw new Error('only a Run in Build or Check can be synced');
    /** @param {...string} args */
    const git = (...args) => gitStep(old.worktree, args);
    // A rebase the user left open is theirs to finish; starting another or aborting it would lose their work.
    for (const dir of ['rebase-merge', 'rebase-apply']) {
      if (fs.existsSync(path.resolve(old.worktree, (yield* git('rev-parse', '--git-path', dir)).stdout.trim())))
        throw new Error(
          'a rebase is already in progress in the Run worktree: finish it with git rebase --continue (or stop it with git rebase --abort), then run sync again',
        );
    }
    const { head, dirty } = yield* worktreeStateFlow(old);
    if (dirty) throw new Error('cannot sync while the Run worktree has uncommitted changes');
    const base = yield* fetchOriginDefaultFlow(projectDir);
    const rebased = yield* git('rebase', base);
    if (rebased.status !== 0) {
      const files = (yield* git('diff', '--name-only', '--diff-filter=U')).stdout.trim().split('\n').filter(Boolean);
      const aborted = yield* git('rebase', '--abort');
      const why = files.length ? `conflicts in ${files.join(', ')}` : `failed: ${rebased.stderr.trim()}`;
      if (aborted.status !== 0)
        throw new Error(`rebase onto origin ${why}; it could not be aborted: ${aborted.stderr.trim()}`);
      throw new Error(
        `rebase onto origin ${why}; the branch is unchanged. To resolve it, run git rebase ${base} in the Run worktree, fix each conflicted file, git add it, run git rebase --continue, then run sync again`,
      );
    }
    const moved = (yield* worktreeStateFlow(old)).head !== head;
    const changed = moved || old.base_sha !== base;
    const record = changed ? clearEvidence({ ...old, base_sha: base }) : { ...old, base_sha: base };
    return { record, activity: changed ? 'Synced with origin; Evidence cleared' : 'Already up to date with origin' };
  });
}
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {{ activity?: string }} [data]
 */
export const syncRun = (projectDir, id, data = {}) => runSync(syncRunFlow(projectDir, id, data));

/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {{ activity?: string }} [data]
 * @param {string[]} [causes]
 */
export function reworkRun(projectDir, id, data = {}, causes = []) {
  const unknown = causes.find((cause) => !REWORK_CAUSES.includes(cause));
  if (unknown !== undefined) throw new Error(`unknown cause "${unknown}" (use ${REWORK_CAUSES.join(', ')})`);
  changeRunning(projectDir, id, data, (old) => {
    if (old.stage !== 'check') throw new Error('only a Run in Check can be sent back to Build');
    if (loops(old) >= loopCap(old)) throw new Error(`the Check loop limit of ${loopCap(old)} is reached`);
    const record = clearEvidence({
      ...recordCauses(moveVisit(firstCheck(old, false), 'build'), [...new Set(causes)], loops(old) + 1),
      stage: 'build',
      check_loops: loops(old) + 1,
    });
    return { record, activity: 'Rework: back to Build' };
  });
}
// The user's answers to a Run that outgrew the size limit in Build (ADR 0035). The commands are for the agent only after the user answered.
/** @param {Run} old */
const waitsForSize = (old) =>
  old.stage === 'build' &&
  old.status === 'waiting' &&
  old.waiting_on_human === true &&
  old.waiting_reason === SIZE_WAIT_REASON;

/** @type {Partial<Run>} */
const released = { status: 'running', waiting_on_human: false, waiting_reason: '' };
export const SPLIT_DONE_REASON = 'Split done: ready for an agent';
/** @type {Partial<Run>} */
const handedOver = { status: 'waiting', waiting_on_human: false, waiting_reason: SPLIT_DONE_REASON };

/** @param {string} type */
const lostEventNote = (type) => `note: the ${type} event could not be recorded; the Event log lacks the entry`;

// Drops the Tickets not yet done from the Run and returns their links. The command line releases the Run to running. The Dashboard's `handOver` leaves it waiting for an agent instead, not on the user (like a Fix, ADR 0034), and `updated` is the record time the user saw: a Run that changed since is refused.
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {{ updated?: string, handOver?: boolean, warn?: (message: string) => void }} [options]
 * @returns {string[]}
 */
export function splitRun(projectDir, id, { updated, handOver = false, warn = console.error } = {}) {
  /** @type {string[]} */
  let moved = [];
  /** @type {string} */
  let dir = '';
  changeRun(projectDir, id, (old) => {
    dir = readRun(projectDir, id).dir;
    if (!waitsForSize(old)) throw new Error('split needs a Run in Build that waits for the Run size answer');
    if (updated !== undefined && updated !== old.updated) throw new Error('the Run changed since it was shown');
    const kept = old.tickets?.slice(0, old.tickets_done ?? 0) ?? [];
    moved = old.tickets?.slice(kept.length) ?? [];
    return {
      ...old,
      ...(handOver ? handedOver : released),
      tickets: kept,
      tickets_total: kept.length,
      activity: 'Split: the remaining Tickets move to a new Run',
      updated: new Date().toISOString(),
    };
  });
  // The links are already computed: a lost event must not hide them from the user, so it is reported and the command succeeds.
  if (!appendEvent(dir, { type: 'split', moved })) warn(lostEventNote('split'));
  return moved;
}

// Without `accept` only measures; with it records the user's acceptance, which also releases a Run that waits for size. `updated` is the record time the user saw: a Run that changed since is refused.
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {{ accept?: boolean, updated?: string, warn?: (message: string) => void }} [options]
 * @returns {import('./run-size.js').RunSize | undefined}
 */
export function sizeRun(projectDir, id, { accept = false, updated, warn = console.error } = {}) {
  if (!accept) return runSize(projectDir, id);
  /** @type {import('./run-size.js').RunSize | undefined} */
  let size;
  changeRun(projectDir, id, (old) => {
    size = runSize(projectDir, id);
    if (old.size_accepted) throw new Error('the Run size is already accepted');
    if (updated !== undefined && updated !== old.updated) throw new Error('the Run changed since it was shown');
    if (!waitsForSize(old) && !(old.status === 'running' && oneOf(['build', 'check'], old.stage)))
      throw new Error('size --accept needs a running Run in Build or Check, or one that waits for the Run size answer');
    const now = new Date().toISOString();
    return {
      ...old,
      ...(waitsForSize(old) ? released : {}),
      size_accepted: now,
      activity: 'The user accepted the Run size',
      updated: now,
    };
  });
  if (!appendEvent(readRun(projectDir, id).dir, { type: 'size-accepted', ...size }))
    warn(lostEventNote('size-accepted'));
  return size;
}

// The user's decision to allow one more Rework (ADR 0024). Not reachable from the command line: only the Dashboard route calls it.
// `updated` is the record time the user saw; a Run that changed since is refused.
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {{ updated?: string }} [options]
 */
export function grantLoopRun(projectDir, id, { updated } = {}) {
  changeRun(projectDir, id, (old) => {
    if (old.stage !== 'check') throw new Error('only a Run in Check can be granted an extra loop');
    if (old.status !== 'waiting' || old.waiting_on_human !== true)
      throw new Error('only a Run that waits on the user can be granted an extra loop');
    if (loops(old) < loopCap(old)) throw new Error(`the Check loop limit of ${loopCap(old)} is not reached`);
    if (updated !== undefined && updated !== old.updated) throw new Error('the Run changed since it was shown');
    return {
      ...old,
      extra_loops: extraLoops(old) + 1,
      status: 'running',
      waiting_on_human: false,
      waiting_reason: '',
      activity: 'The user granted an extra Check loop on the Dashboard',
      updated: new Date().toISOString(),
    };
  });
}
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {{ activity?: string }} [data]
 */
export function completeRun(projectDir, id, data = {}) {
  changeRunning(projectDir, id, data, (old) => {
    if (!oneOf(['finish', 'follow-up'], old.stage))
      throw new Error('only a Run in Finish or Follow-up can be completed');
    if (!old.pr) throw new Error('completing a Run needs a PR link');
    if (old.tickets_done !== undefined && old.tickets_total !== undefined && old.tickets_done > old.tickets_total)
      throw new Error(`more Tickets done (${old.tickets_done}) than counted (${old.tickets_total})`);
    return {
      record: { ...moveVisit(old, null), status: 'done', waiting_on_human: false, waiting_reason: '' },
      activity: 'Done',
    };
  });
}
