/** @import { Run } from './run-record.js' */
/** @import { PrLookup } from './run-clean.js' */
import path from 'node:path';
import { followUpRun } from './run-follow-up.js';
import { summarizeMetrics, totalMetrics } from './run-metrics.js';
import { totalUsage } from './run-usage.js';
import { reviewPlan } from './project-reviews.js';
import { tracks } from './run-record.js';
import { readRun, listRuns, readRunFile, mainCheckout } from './run-folder.js';
import { worktreeState } from './worktrees.js';
import { finishProblems, verifyRun, verdictRun, projectReviewRun, materializeReview } from './evidence.js';
import {
  startRun,
  trackRun,
  updateRun,
  transitionRun,
  acceptRun,
  grantLoopRun,
  syncRun,
  reworkRun,
  completeRun,
} from './run-lifecycle.js';
import { repairPlan, repairApply, inspectRuns } from './run-repair.js';
import { removeRun, cleanRun, cleanAll } from './run-clean.js';
import { sweepRun } from './run-sweep.js';
import { guidesRun } from './guides.js';
import { sizeWarnings } from './run-size.js';

export { summarizeMetrics, formatMetrics } from './run-metrics.js';
export { MAX_CHECK_LOOPS, loopCap, verifyCommandProblem, fastCommandProblem, trackOf } from './run-record.js';
export { mergedLeftovers } from './run-clean.js';

// The one interface to the modules that touch .factory/runs. remove(id, why, options) reports dirty work separately from other refusals.
/** @param {string} callerDir */
export function openRunStore(callerDir) {
  const { dir: projectDir } = mainCheckout(callerDir);
  const runsDir = path.resolve(projectDir, '.factory', 'runs');
  return {
    projectDir,
    /** @param {Partial<Run>} data */
    start: (data) => startRun(projectDir, data),
    /** @param {string} id @param {Partial<Run>} data */
    update: (id, data) => updateRun(projectDir, id, data),
    /** @param {string} id @param {string} value */
    track: (id, value) => trackRun(projectDir, id, value),
    /** @param {string} id @param {string} to @param {{ activity?: string }} [data] */
    transition: (id, to, data) => transitionRun(projectDir, id, to, data),
    /** @param {string} id */
    followUp: (id) => followUpRun(projectDir, id),
    /** @param {string} id @param {{ activity?: string }} [data] @param {string[]} [causes] */
    rework: (id, data, causes) => reworkRun(projectDir, id, data, causes),
    /** @param {string} id @param {{ activity?: string }} [data] */
    sync: (id, data) => syncRun(projectDir, id, data),
    /** @param {string} id @param {{ activity?: string }} [data] */
    complete: (id, data) => completeRun(projectDir, id, data),
    /** @param {string} id @param {unknown} data */
    accept: (id, data) => acceptRun(projectDir, id, data),
    /** @param {string} id @param {{ updated?: string }} [data] */
    grantLoop: (id, data) => grantLoopRun(projectDir, id, data),
    /** @param {string} id @param {{ fast?: boolean }} [options] */
    verify: (id, options) => verifyRun(projectDir, id, options),
    /** @param {string} id @param {string} axis @param {string} value @param {{ carried?: boolean }} [options] */
    verdict: (id, axis, value, options) => verdictRun(projectDir, id, axis, value, options),
    /** @param {string} id @param {string[]} [terms] */
    sweep: (id, terms) => sweepRun(projectDir, id, terms),
    /** @param {string} id */
    sizeWarnings: (id) => sizeWarnings(projectDir, id),
    /** @param {string} id */
    guides: (id) => guidesRun(projectDir, id),
    /** @param {string} id */
    config: (id) => readRun(projectDir, id).record.project_config ?? null,
    /** @param {string} id */
    reviews: (id) => reviewPlan(readRun(projectDir, id).record),
    /** @param {string} id @param {string} axis @param {any} data The untrusted report. */
    review: (id, axis, data) => projectReviewRun(projectDir, id, axis, data),
    /** @param {string} id @param {string} axis */
    materializeReview: (id, axis) => materializeReview(projectDir, id, axis),
    /** @param {string} id */
    mergeEligibility: (id) => {
      const { record } = readRun(projectDir, id);
      const state = worktreeState(record);
      return { ...state, problems: finishProblems(record, state), worktree: record.worktree };
    },
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
    /** @param {string} id */
    repairPlan: (id) => repairPlan(projectDir, runsDir, id),
    /** @param {string} id @param {unknown} plan */
    repairApply: (id, plan) => repairApply(projectDir, runsDir, id, plan),
    /** @param {string} rawPath */
    readFile: (rawPath) => readRunFile(runsDir, rawPath),
    /** @param {string} id @param {(reason: string) => void} [why] @param {{ discardChanges?: boolean, doneOnly?: boolean }} [options] */
    remove: (id, why, options) => removeRun(projectDir, id, why, options),
    /** @param {string} id @param {{ prState?: PrLookup }} [options] */
    clean: (id, { prState } = {}) => cleanRun(projectDir, callerDir, id, prState),
    /** @param {{ prState?: PrLookup }} [options] */
    cleanAll: ({ prState } = {}) => cleanAll(projectDir, callerDir, prState),
  };
}
