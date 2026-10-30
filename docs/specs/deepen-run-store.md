# Deepen the Run store

## Problem Statement

`src/run-store.js` is 869 lines, about two thirds of `src/`. The Run record rules, the Run folder and its locks, the git worktree helpers, the gates and Evidence, and Run repair all sit in one file. Run metrics, a Follow-up Stage, a Fast track and a project config file would each have to edit it and read all of it first. This is GitHub issue #243.

## Solution

Split the file into modules at the seams named in [ADR 0012](../adr/0012-run-store-is-split-by-seam.md), behind the same `openRunStore` interface. No behavior changes.

## User Stories

1. As a maintainer, I want the Run record rules in their own module, so that adding a field touches one small file.
2. As a maintainer, I want the gates and Evidence in their own module, so that a Fast track or metrics change reads only that code.
3. As a maintainer, I want the Stage operations in their own module, so that a Follow-up Stage is added in one place.
4. As a maintainer, I want worktree, folder and lock helpers and repair apart from them, so that each has one reason to change.
5. As a user of the CLI and the Dashboard, I want no change in output, `run.json` or the API.
6. As a maintainer, I want every existing test to pass unchanged, so that the split is shown not to change behavior.
7. As a maintainer, I want the design recorded in an ADR and the module layout in `docs/development.md`.

## Implementation Decisions

- Modules: `run-record.js`, `run-folder.js`, `worktrees.js`, `evidence.js`, `run-lifecycle.js`, `run-repair.js`, `run-clean.js`; `run-store.js` keeps `openRunStore` and re-exports `MAX_CHECK_LOOPS`, `verifyCommandProblem` and `mergedLeftovers`.
- Code moves without edits; imports are the only new lines. No import cycles.
- Out of scope: Run metrics, a Follow-up Stage, a Fast track, a project config file, and any rename or tidy of the moved code.

## Testing Decisions

No test changes. The existing tests cross the `openRunStore` interface, which is the seam that must not move. A changelog fragment records the change.
