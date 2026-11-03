/** @import { Run } from './run-record.js' */
/** @import { PrLookup, SyncPrLookup } from './run-clean.js' */
import path from 'node:path';
import { followUpRun } from './run-follow-up.js';
import { summarizeMetrics, totalMetrics } from './run-metrics.js';
import { totalUsage } from './run-usage.js';
import { reviewPlan } from './project-reviews.js';
import { tracks } from './run-record.js';
import { readRun, listRuns, readRunFile, mainCheckout } from './run-folder.js';
import { worktreeState, worktreeStateFlow } from './worktrees.js';
import { runAsync } from './git.js';
import { finishProblems, verifyRun, verdictRun, projectReviewRun, materializeReview } from './evidence.js';
import {
  startRun,
  trackRun,
  updateRun,
  transitionRun,
  acceptRun,
  grantLoopRun,
  syncRun,
  syncRunFlow,
  acceptRunFlow,
  reworkRun,
  completeRun,
} from './run-lifecycle.js';
import { repairPlan, repairApply, inspectRuns } from './run-repair.js';
import { removeRun, removeRunFlow, cleanRun, cleanRunFlow, cleanAll, ghPrInfoAsync } from './run-clean.js';
import { sweepRun } from './run-sweep.js';
import { guidesRun } from './guides.js';
import { sizeWarnings } from './run-size.js';

export { summarizeMetrics, formatMetrics } from './run-metrics.js';
export { MAX_CHECK_LOOPS, loopCap, verifyCommandProblem, fastCommandProblem, trackOf } from './run-record.js';
export { mergedLeftovers } from './run-clean.js';

/** @param {Run} record @param {{ head: string, dirty: boolean }} state */
const eligibility = (record, state) => ({
  ...state,
  problems: finishProblems(record, state),
  worktree: record.worktree,
});

// The one interface to the modules that touch .factory/runs. The CLI passes its flags through unchanged, so an id, Stage, axis or value may be undefined; the module that uses it refuses it. remove(id, why, options) reports dirty work separately from other refusals.
/** @param {string} callerDir */
export function openRunStore(callerDir) {
  const { dir: projectDir } = mainCheckout(callerDir);
  const runsDir = path.resolve(projectDir, '.factory', 'runs');
  return {
    projectDir,
    /** @param {Partial<Run>} data */
    start: (data) => startRun(projectDir, data),
    /** @param {string | undefined} id @param {Partial<Run>} data */
    update: (id, data) => updateRun(projectDir, id, data),
    /** @param {string | undefined} id @param {string | undefined} value */
    track: (id, value) => trackRun(projectDir, id, value),
    /** @param {string | undefined} id @param {string | undefined} to @param {{ activity?: string }} [data] */
    transition: (id, to, data) => transitionRun(projectDir, id, to, data),
    /** @param {string | undefined} id */
    followUp: (/** @type {string | undefined} */ id, /** @type {{ scope?: string }} */ options = {}) =>
      followUpRun(projectDir, id, options),
    /** @param {string | undefined} id @param {{ activity?: string }} [data] @param {string[]} [causes] */
    rework: (id, data, causes) => reworkRun(projectDir, id, data, causes),
    /** @param {string | undefined} id @param {{ activity?: string }} [data] */
    sync: (id, data) => syncRun(projectDir, id, data),
    /** @param {string | undefined} id @param {{ activity?: string }} [data] */
    complete: (id, data) => completeRun(projectDir, id, data),
    /** @param {string | undefined} id @param {unknown} data */
    accept: (id, data) => acceptRun(projectDir, id, data),
    /** @param {string | undefined} id @param {{ updated?: string }} [data] */
    grantLoop: (id, data) => grantLoopRun(projectDir, id, data),
    /** @param {string | undefined} id @param {{ fast?: boolean }} [options] */
    verify: (id, options) => verifyRun(projectDir, id, options),
    /** @param {string | undefined} id @param {string | undefined} axis @param {string | undefined} value @param {{ carried?: boolean }} [options] */
    verdict: (id, axis, value, options) => verdictRun(projectDir, id, axis, value, options),
    /** @param {string | undefined} id @param {string[]} [terms] */
    sweep: (id, terms) => sweepRun(projectDir, id, terms),
    /** @param {string | undefined} id */
    sizeWarnings: (id) => sizeWarnings(projectDir, id),
    /** @param {string | undefined} id */
    guides: (id) => guidesRun(projectDir, id),
    /** @param {string | undefined} id */
    config: (id) => readRun(projectDir, id).record.project_config ?? null,
    /** @param {string | undefined} id */
    reviews: (id) => reviewPlan(readRun(projectDir, id).record),
    /** @param {string | undefined} id @param {string | undefined} axis @param {any} data The untrusted report. */
    review: (id, axis, data) => projectReviewRun(projectDir, id, axis, data),
    /** @param {string | undefined} id @param {string | undefined} axis */
    materializeReview: (id, axis) => materializeReview(projectDir, id, axis),
    /** @param {string | undefined} id */
    mergeEligibility: (id) => {
      const { record } = readRun(projectDir, id);
      return eligibility(record, worktreeState(record));
    },
    // The Dashboard's variants of the operations below: the same logic, with git calls that do not block the event loop.
    /** @param {string | undefined} id */
    mergeEligibilityAsync: async (id) => {
      const { record } = readRun(projectDir, id);
      return eligibility(record, await runAsync(worktreeStateFlow(record)));
    },
    /** @param {string | undefined} id @param {{ activity?: string }} [data] */
    syncAsync: (id, data) => runAsync(syncRunFlow(projectDir, id, data)),
    /** @param {string | undefined} id @param {unknown} data */
    acceptAsync: (id, data) => runAsync(acceptRunFlow(projectDir, id, data)),
    /** @param {string} id @param {(reason: string) => void} [why] @param {{ discardChanges?: boolean, doneOnly?: boolean }} [options] */
    removeAsync: (id, why, options) => runAsync(removeRunFlow(projectDir, id, why, options)),
    /** @param {string | undefined} id @param {{ prState?: PrLookup }} [options] */
    cleanAsync: (id, { prState } = {}) => runAsync(cleanRunFlow(projectDir, callerDir, id, prState ?? ghPrInfoAsync)),
    list: () => listRuns(runsDir),
    /** @param {string} [id] */
    stats: async (id) => {
      const entries = await listRuns(runsDir);
      if (id && !entries.some((entry) => entry.id === id)) throw new Error(`Run not found: ${id}`);
      const selected = id ? entries.filter((entry) => entry.id === id) : entries;
      const now = Date.now();
      const runs = selected.map((entry) => ({
        id: entry.id,
        unreadable: entry.unreadable,
        summary: entry.unreadable ? null : summarizeMetrics(entry.record, now),
      }));
      const readable = runs.flatMap((run) => (run.summary ? [run.summary] : []));
      const byTrack = Object.fromEntries(
        tracks.map((track) => [
          track,
          {
            runs: readable.filter((summary) => summary.track === track).length,
            total: totalMetrics(readable.filter((summary) => summary.track === track)),
          },
        ]),
      );
      const usage = totalUsage(runs.filter((run) => run.summary));
      return { runs, total: totalMetrics(readable), byTrack, usage };
    },
    /** @param {string} [id] */
    inspect: (id) => inspectRuns(projectDir, runsDir, id),
    /** @param {string | undefined} id */
    repairPlan: (id) => repairPlan(projectDir, runsDir, id),
    /** @param {string | undefined} id @param {unknown} plan */
    repairApply: (id, plan) => repairApply(projectDir, runsDir, id, plan),
    /** @param {string} rawPath */
    readFile: (rawPath) => readRunFile(runsDir, rawPath),
    /** @param {string} id @param {(reason: string) => void} [why] @param {{ discardChanges?: boolean, doneOnly?: boolean }} [options] */
    remove: (id, why, options) => removeRun(projectDir, id, why, options),
    /** @param {string | undefined} id @param {{ prState?: SyncPrLookup }} [options] */
    clean: (id, { prState } = {}) => cleanRun(projectDir, callerDir, id, prState),
    /** @param {{ prState?: SyncPrLookup }} [options] */
    cleanAll: ({ prState } = {}) => cleanAll(projectDir, callerDir, prState),
  };
}
