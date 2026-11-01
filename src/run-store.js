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
export function openRunStore(callerDir) {
  const { dir: projectDir } = mainCheckout(callerDir);
  const runsDir = path.resolve(projectDir, '.factory', 'runs');
  return {
    projectDir,
    start: (data) => startRun(projectDir, data),
    update: (id, data) => updateRun(projectDir, id, data),
    track: (id, value) => trackRun(projectDir, id, value),
    transition: (id, to, data) => transitionRun(projectDir, id, to, data),
    followUp: (id) => followUpRun(projectDir, id),
    rework: (id, data) => reworkRun(projectDir, id, data),
    sync: (id, data) => syncRun(projectDir, id, data),
    complete: (id, data) => completeRun(projectDir, id, data),
    accept: (id, data) => acceptRun(projectDir, id, data),
    grantLoop: (id, data) => grantLoopRun(projectDir, id, data),
    verify: (id, options) => verifyRun(projectDir, id, options),
    verdict: (id, axis, value, options) => verdictRun(projectDir, id, axis, value, options),
    sweep: (id, terms) => sweepRun(projectDir, id, terms),
    sizeWarnings: (id) => sizeWarnings(projectDir, id),
    guides: (id) => guidesRun(projectDir, id),
    config: (id) => readRun(projectDir, id).record.project_config ?? null,
    reviews: (id) => reviewPlan(readRun(projectDir, id).record),
    review: (id, axis, data) => projectReviewRun(projectDir, id, axis, data),
    materializeReview: (id, axis) => materializeReview(projectDir, id, axis),
    mergeEligibility: (id) => {
      const { record } = readRun(projectDir, id);
      const state = worktreeState(record);
      return { ...state, problems: finishProblems(record, state), worktree: record.worktree };
    },
    list: () => listRuns(runsDir),
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
      const readable = runs.filter((run) => run.summary).map((run) => run.summary);
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
    inspect: (id) => inspectRuns(projectDir, runsDir, id),
    repairPlan: (id) => repairPlan(projectDir, runsDir, id),
    repairApply: (id, plan) => repairApply(projectDir, runsDir, id, plan),
    readFile: (rawPath) => readRunFile(runsDir, rawPath),
    remove: (id, why, options) => removeRun(projectDir, id, why, options),
    clean: (id, { prState } = {}) => cleanRun(projectDir, callerDir, id, prState),
    cleanAll: ({ prState } = {}) => cleanAll(projectDir, callerDir, prState),
  };
}
