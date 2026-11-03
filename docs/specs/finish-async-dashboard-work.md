# Finish the async Dashboard work

## Problem Statement

PR #455 made the Dashboard's git calls async but left three gaps.

1. The accept route is the only action that is guarded against overlap, by a module-level Set that every Dashboard in the process shares. Sync, clean, delete, extra-loop and merge can still overlap an accept, or each other, on the same Run while a git call is awaited. When an accept fails, the compensating update that puts the Run back to `waiting` needs the Run lock too and can throw, which leaves the Run `running`.
2. `POST /api/runs/:id/clean` looks up the PR with the sync `view` (`spawnSync` of `gh` or `az`, 10 s timeout), so it blocks the event loop and every other request.
3. `gitAsync` reports a `maxBuffer` overflow like a kill, and the origin lookup then tells the user "origin did not answer within 20s" for an overflow.

## Solution

- One in-flight guard per Run covers every action route (accept, sync, clean, delete, extra-loop, merge). It belongs to one Dashboard, so two Dashboards in a process do not block each other. A second concurrent action on the same Run is answered 409 "another action on this Run is already running". The guard is released in `finally`.
- If the compensating update after a failed accept fails, the cause goes to stderr and the user still gets the original error.
- The Dashboard's clean-up looks the PR up without blocking: GitHub and Azure DevOps both have `viewAsync`, the lookup type accepts a sync or an async function, and the CLI keeps the sync `view`.
- `gitAsync` marks a real timeout with `timedOut: true` on its error; a `maxBuffer` overflow keeps its own code and is not reported as a timeout.

Routes, auth (ADR 0017) and response bodies do not change, except the 409 text above.

## User Stories

1. As a Dashboard user, I want a second action on a Run that is already busy to be refused with a clear 409, so that two git operations never overlap on one Run.
2. As a Dashboard user, I want that refusal to cover sync, clean, delete, extra-loop, accept and merge, so that no action slips past the guard.
3. As a Dashboard user, I want actions on different Runs to proceed at the same time, so that one slow Run does not hold up the others.
4. As a Dashboard user, I want a Run to be released after any outcome (success, refusal, error), so that I can act on it again without restarting.
5. As a Dashboard user, I want a failed accept to leave the Run `waiting` again, or the real cause on the console when that is not possible, so that a Run is not stuck `running`.
6. As a Dashboard user, I want the original accept error in the answer even when the rollback fails, so that I see what actually went wrong.
7. As a developer running two Dashboards in one process (tests), I want their guards to be independent, so that tests do not interfere.
8. As a Dashboard user, I want other requests to be answered while a slow `gh` or `az` PR lookup runs for clean, so that the page stays responsive.
9. As a Dashboard user with an Azure DevOps Run, I want clean to use the same non-blocking lookup, so that both hosts behave alike.
10. As a CLI user, I want `run clean`, `run clean --all` and Doctor to keep their sync lookup, so that nothing about the CLI changes.
11. As a maintainer, I want one parser for the PR state and head for the sync and async variants, so that they cannot drift.
12. As a maintainer, I want `gh` and `az` to run only in the two adapters, so that the PR provider seam (ADR 0020) holds.
13. As a test author, I want to keep injecting `prInfo` and the adapter `run`, so that tests never call the hosts.
14. As a user with a Run whose origin returns a huge answer, I want the message not to claim a timeout, so that I look at the right problem.
15. As a user behind a slow network, I want the timeout message kept, so that I still learn to check the network or credential helper.
16. As a Windows contributor, I want git tests that need no `user.email` and leave no killed child holding a temp folder, so that CI passes on Windows.

## Implementation Decisions

- The guard is a Set of Run ids in the per-Dashboard services object. One helper acquires it after the Run is found and releases it in `finally`; `runAction`, the merge handler and the delete handler all use it. The guard check comes before the action's own state checks, so a busy Run answers the guard text first. Read routes (`merge-checks`, `pr-status`, views, files) are not guarded.
- The compensating `waiting` update in accept is wrapped: on failure the cause is logged with the existing stderr helper, and the original error is rethrown.
- Lookup type: a PR lookup may return the answer or a Promise of it. A shared function turns a provider view into `{ state, head }` (undefined when the state is not a string). The sync default stays the CLI/Doctor default. A new async default is used by the Run store's async clean when no lookup is injected. An injected `prInfo` wins in both.
- GitHub and Azure DevOps both expose `viewAsync`; the Azure one reuses the existing async reader and the shared state parser. The provider typedef lists `viewAsync` as an optional operation with an injectable `run`. If a provider has no `viewAsync`, the async lookup returns undefined (the Run is kept).
- `gitAsync` sets `timedOut: true` on the error when execFile kills the child for its timeout, and not when the error code is the `maxBuffer` overflow. The origin lookup reads `ETIMEDOUT` or `timedOut`, no longer `killed`/`signal`.

## Testing Decisions

- Good tests check external behavior: HTTP answers, Run record status, stderr output, and results of `gitAsync`, not the contents of the Set.
- Highest seam is the Dashboard over HTTP (`startDashboard` with real temp Runs, as in the existing dashboard action tests) for the guard and the PR lookup; `gitAsync` and the origin flow are tested directly.
- Guard tests: two different actions on one Run at the same time (one 409 with the guard text, the Run not left `running`); the same action on two Runs both 200; a failing rollback logs to stderr and answers the original error. Held actions are made slow through a deferred injected seam (`prMerge`, `prInfo`).
- PR lookup tests: a slow injected async `prInfo` or a slow adapter `run`; a second request (for example `GET /api/info`) is answered while the clean is pending. Adapter tests for both `viewAsync` variants use the existing recorded fixtures and injected `run`.
- gitAsync tests: a timeout case sets `timedOut`, a tiny `maxBuffer` case does not (it has the overflow code). Prior art: the existing timeout test in the git tests, which runs in the OS temp directory so no killed child holds a created folder; git calls pass `-c user.name -c user.email` so no global identity is needed.
- origin test: an overflow error is not reported as a timeout.

## Out of Scope

- New routes, changed auth, changed response bodies, a queue or wait instead of a 409.
- Making the sync CLI paths (`run clean --all`, Doctor leftovers, `run-size`, `run-repair`) async.
- Guarding read routes, the PR status caches, or the Follow-up scope.
- New host adapters.

## Documents

`docs/dashboard.md`, `docs/development.md`, `docs/adr/0030-one-flow-of-git-steps-runs-sync-for-the-cli-and-async-for-the-dashboard.md` (edited in place), `docs/adr/0020-pr-providers-sit-behind-one-seam.md` (it says Azure has no `viewAsync`), `docs/specs/dashboard-azure-devops.md` (names `view(url)` as the only detail read) read-only unless stale, `changelog.d/finish-async-dashboard-work.md`. No GLOSSARY change.
