import path from 'node:path';
import { reviewPlan } from './project-reviews.js';
import { readRun, listRuns, readRunFile, mainCheckout } from './run-folder.js';
import { worktreeState } from './worktrees.js';
import { finishProblems, verifyRun, verdictRun, projectReviewRun, materializeReview } from './evidence.js';
import { startRun, updateRun, transitionRun, acceptRun, syncRun, reworkRun, completeRun } from './run-lifecycle.js';
import { repairPlan, repairApply, inspectRuns } from './run-repair.js';
import { removeRun, cleanRun, cleanAll } from './run-clean.js';

export { MAX_CHECK_LOOPS, verifyCommandProblem } from './run-record.js';
export { mergedLeftovers } from './run-clean.js';

// The one interface to the modules that touch .factory/runs. remove(id, why, options) reports dirty work separately from other refusals.
export function openRunStore(callerDir) {
  const { dir: projectDir } = mainCheckout(callerDir);
  const runsDir = path.resolve(projectDir, '.factory', 'runs');
  return {
    projectDir,
    start: (data) => startRun(projectDir, data),
    update: (id, data) => updateRun(projectDir, id, data),
    transition: (id, to, data) => transitionRun(projectDir, id, to, data),
    rework: (id, data) => reworkRun(projectDir, id, data),
    sync: (id, data) => syncRun(projectDir, id, data),
    complete: (id, data) => completeRun(projectDir, id, data),
    accept: (id, data) => acceptRun(projectDir, id, data),
    verify: (id) => verifyRun(projectDir, id),
    verdict: (id, axis, value) => verdictRun(projectDir, id, axis, value),
    reviews: (id) => reviewPlan(readRun(projectDir, id).record),
    review: (id, axis, data) => projectReviewRun(projectDir, id, axis, data),
    materializeReview: (id, axis) => materializeReview(projectDir, id, axis),
    mergeEligibility: (id) => {
      const { record } = readRun(projectDir, id);
      const state = worktreeState(record);
      return { ...state, problems: finishProblems(record, state), worktree: record.worktree };
    },
    list: () => listRuns(runsDir),
    inspect: (id) => inspectRuns(projectDir, runsDir, id),
    repairPlan: (id) => repairPlan(projectDir, runsDir, id),
    repairApply: (id, plan) => repairApply(projectDir, runsDir, id, plan),
    readFile: (rawPath) => readRunFile(runsDir, rawPath),
    remove: (id, why, options) => removeRun(projectDir, id, why, options),
    clean: (id, { prState } = {}) => cleanRun(projectDir, callerDir, id, prState),
    cleanAll: ({ prState } = {}) => cleanAll(projectDir, callerDir, prState),
  };
}
