# Live eval baseline on Claude

## Problem Statement

`npm run eval` has never been run against a live client, so nobody knows whether a model follows the Flow or whether the graders report false failures. `docs/capabilities.md` has Claude cells that nothing has checked. This is GitHub issue #244.

## Solution

Run the seven scenarios against live Claude, one at a time on the cheapest model, and record the results in `docs/evaluation.md` with the model named. Where a scenario fails because the grader is wrong, fix the grader. Where the agent ignored the Flow, tighten the `## Invoked Skills` section of the `factory` Skill. Settle the Claude cells in `docs/capabilities.md` that the runs prove, and leave the rest marked not verified with the reason. Add a workflow that starts the eval by hand.

## User Stories

1. As a maintainer, I want every scenario run against live Claude, so that the Flow has a measured baseline.
2. As a maintainer, I want the model, date and Claude Code version recorded with each result, so that the baseline can be compared later.
3. As a maintainer, I want a failing scenario to tell me whether the grader or the agent is wrong, so that I fix the right thing.
4. As a maintainer, I want the `## Invoked Skills` section tightened where the agent ignored the Flow, so that the next run improves.
5. As a maintainer, I want the Claude "Not verified" cells settled or kept with a reason, so that the matrix does not claim what was not checked.
6. As a maintainer, I want to start the eval from the Actions tab with a chosen scenario and timeout, so that I need no local setup.
7. As a maintainer, I want the eval limited to Claude and never run by `npm test` or on a pull request, so that it costs nothing unless started.

## Implementation Decisions

- Cost: Haiku 5.5 through `EVAL_AGENT_CMD`, a 5-minute `EVAL_TIMEOUT_MS`, one scenario at a time, stop at the first failure. No rerun on a larger model in this issue; improving the baseline model is for 0.6.0.
- Ticket 1 holds the live runs, grader and Skill fixes, the results and the capabilities cells. Ticket 2 holds the workflow. The workflow takes `workflow_dispatch` inputs `scenarios`, `model` and `timeout_minutes`, reads the Claude credential from a repository secret, and has no other trigger.
- Out of scope: Codex and Copilot (0.5.x), a full-suite rerun on a larger model, and changes outside the eval, the `factory` Skill's Invoked Skills section and the two docs.

## Testing Decisions

`test/eval-harness.test.js` stays the check for graders; a grader change gets a scripted stand-in case there. The live runs are the evidence for the Skill text and are recorded, not asserted in `npm test`. A test checks that the workflow is manual-only.
