# Split the Run store by seam behind one interface

`src/run-store.js` had grown to 869 lines that mixed these concerns: the rules for a Run record, the Run folder and its locks, git worktrees, the gates and Evidence, the Stage operations, Run repair and clean-up. Each next feature (Run metrics, a Follow-up Stage, a Fast track, a project config file) would have had to edit the same file and read all of it first.

The Run store now keeps `openRunStore` and its interface unchanged, and the work lives in modules placed where a change of one kind stays in one place. Each module imports only from the ones above it, so there are no cycles.

| Module             | Holds                                                                                                            | A feature that lands here                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `run-record.js`    | Field rules, `validate`, `apply`, atomic `write`, `MAX_CHECK_LOOPS`, the Check attempt                           | a new `run.json` field, a project config file's limits      |
| `run-folder.js`    | Run folder paths, symlink refusal, locks, `readRun`, `changeRun`, `changeRunning`, listing, main-checkout lookup | storage layout                                              |
| `worktrees.js`     | `worktreeState`, fetching origin's default branch, merge check, Run worktree listing, uncommitted-work checks    | where a Run branches from                                   |
| `evidence.js`      | `finishProblems`, `clearEvidence`, `verifyRun`, `verdictRun`, project review recording and materialising         | a Fast track that skips axes, Run metrics from Verify times |
| `run-lifecycle.js` | start, update, transition, accept, sync, rework, complete                                                        | a Follow-up Stage                                           |
| `run-repair.js`    | `repairPlan`, `repairApply`, `inspectRuns`                                                                       | new repair findings                                         |
| `run-clean.js`     | `removeRun`, `cleanRun`, `cleanAll`, `mergedLeftovers`                                                           | clean-up rules                                              |
| `run-store.js`     | `openRunStore`, `MAX_CHECK_LOOPS`, `verifyCommandProblem`, `mergedLeftovers`                                     |                                                             |

The modules are an internal split, not new public interfaces. The CLI, the Dashboard and Doctor keep importing `run-store.js` only, and the tests go through `openRunStore`, so one test surface still covers everything. The split moves code without editing it: the Run record shape, CLI output and Dashboard API are unchanged.

We did not make a class holding the store's state, because nothing varies across it: there is one filesystem, one git, one GitHub. A seam with a single adapter would be hypothetical. If a second kind of store appears, `run-folder.js` is where it would plug in.

This extends [ADR 0006](0006-run-progress-goes-through-named-transitions.md): every change to a Run's progress still goes through a named operation in `run-lifecycle.js` or `evidence.js`, which call `changeRun` under the Run lock. Repair and clean-up, which already wrote or removed Runs under the lock, stay in `run-repair.js` and `run-clean.js`. See [the Spec](../specs/split-run-store-by-seam.md).
