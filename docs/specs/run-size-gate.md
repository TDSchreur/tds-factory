# Size gate: estimate in Define, split proposal, check during Build

Design: [ADR 0035](../adr/0035-build-waits-on-the-user-when-a-run-outgrows-the-size-limit.md). Builds on [Reduce the number of Check loops per Run](reduce-check-loops.md), where the size limit was only a warning at the transition to Check.

## Problem Statement

A Run whose diff passes about 40 KB or 15 files reaches Check reviewers in pieces, and Check loses its value. Today the limit is a Define estimate that nothing records and a warning at `run transition --to check`, when all the code is written and a split is expensive. The warning also counts lockfiles and recorded test fixtures, which no reviewer reads, so it misleads.

## Solution

Measure the Run size in a way that matches what reviewers read, put the estimate in the Spec so Define can propose a split, and let Build stop the Run for a decision as soon as the real size passes the limit while Tickets remain. The user splits (the remaining Tickets go to a new Run) or accepts the size (no more size waits for this Run).

This work is cut into several Runs, because it does not fit in one (see the estimate below). **Run A** (Tickets published) builds the measurement, the wait and the two answers on the command line. **Run B** is itself cut into several Runs: [Size gate B](run-size-gate-b.md) carries the Skill text for Define, the Fast track and the Waiting rule (stories 10, 11 and 13); the Dashboard buttons (story 12) are [#530](https://github.com/TDSchreur/tds-factory/issues/530) ([Split and Continue](dashboard-split-and-continue-buttons.md)); the leftovers of Run A are [#532](https://github.com/TDSchreur/tds-factory/issues/532) ([Size gate leftovers](run-size-gate-leftovers.md)).

## User Stories

Run A:

1. As a maintainer, I want the Run size to be the whole diff against `base_sha` in files and bytes, leaving out lockfiles and files under `test/fixtures/`, so that it matches what reviewers read.
2. As a user, I want a Run in Build to wait on me with "Run size over the limit: split the remaining Tickets into a new Run?" when raising `tickets_done` leaves the size over the limit and Tickets remain, so that I decide before more code is written.
3. As an agent, I want that `run update` to succeed, so that the Ticket I finished is recorded.
4. As a user, I want `tds-factory run split --id <id>` to drop the Tickets not yet done from the Run, print their links and release the Run, so that the Run goes on to Check with what is done and the agent can start a new Run for the rest.
5. As a user, I want `tds-factory run size --id <id> --accept` to record my acceptance in the Event log and release a Run that waits for size, or to record it for a running Run in Build or Check, so that no more size waits or warnings happen for this Run.
6. As a user, I want `run transition --to check` to keep its warning, except after I accepted the size, so that I am not told again what I decided.
7. As a maintainer, I want `run update` to refuse `size_accepted`, and `split` to refuse a Run that is not waiting for size in Build, and `size --accept` a Run that neither waits for size nor is running in Build or Check, so that an agent cannot decide for the user by the usual commands.
8. As a user, I want the split and the acceptance in the Event log, so that the history of the Run shows who decided what.
9. As an agent, I want `references/progress-commands.md` to say that I run `split` or `size --accept` only after the user answered, as for `run track`, so that I never decide for the user.

Run B ([Size gate B](run-size-gate-b.md) and [#530](https://github.com/TDSchreur/tds-factory/issues/530)):

10. As a user, I want Define to put an estimate per Ticket (files, KB) in the Spec and, when the total passes the limit, to propose a split into several Runs with a suggested cut in the confirmation, so that I decide before Build.
11. As a user, I want the Fast track to move to the Full track when the estimate passes the limit.
12. As a user, I want Split and Continue buttons on a Run waiting for size, guarded like the other write routes, so that I can answer from the Dashboard.
13. As an agent, I want the Waiting section of `SKILL.md` to say what to do after each answer, so that I start the new Run with `/factory` and the moved Ticket links.

## Implementation Decisions

- **Measure.** `src/run-size.js` gets `runSize(projectDir, id)` returning `{ files, bytes }` for `git diff base_sha HEAD` (committed work only), with pathspec excludes for lockfiles (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `Cargo.lock`, `Gemfile.lock`, `poetry.lock`, `Pipfile.lock`, `composer.lock`, `go.sum`, `packages.lock.json`, at any depth) and `test/fixtures/`. `sizeWarnings` uses it, so the transition warning and the wait count the same. Limits stay `MAX_DIFF_BYTES` 40 KB and `MAX_FILES` 15. When git fails the size is unknown and nothing waits, as `sizeWarnings` already returns no warnings then. An overflow of git's output and a git call that takes longer than 60 seconds are not unknown: they count as over the limit, and `run size` says so.
- **Wait.** `updateRun` compares `tickets_done` before and after. When it rose, the Run is in Build, not all Tickets are done, `size_accepted` is not set and the size is over the limit, the record is saved with the update's fields plus `status: waiting`, `waiting_on_human: true` and the reason above (exported as a constant). The existing `waiting` event follows from the change. Measuring happens under the Run lock, in the same change.
- **Accepted.** `size_accepted` is a new gated field (ISO time, absent means not accepted), in the gated list and the run schema table, so `run update` refuses it.
- **Commands.** Store operations `splitRun` and `sizeRun` in `src/run-lifecycle.js`, listed in `src/run-store.js`, with `run split --id` and `run size --id [--accept]` in `bin/tds-factory.js` (`--accept` is a new option). `run size` without `--accept` prints the files and KB, reads only and writes nothing. `split` refuses unless the Run is in Build and waits with the size reason; `size --accept` also works on a running Run in Build or Check, to silence the transition warning, and releases a waiting one.
- **Split.** Keeps the first `tickets_done` entries of `tickets` (Tickets are done in order), sets `tickets_total` to match, prints the moved links one per line, sets the Run to running with the waiting fields cleared and the activity "Split: the remaining Tickets move to a new Run". The Event log gets a `split` event with `moved` (the links).
- **Accept.** Sets `size_accepted`, releases a waiting Run and adds a `size-accepted` event with the size at that moment (`files`, `bytes`).
- **Transition.** `bin/tds-factory.js` prints the size warnings (size and file count, not the commit-count one) only when `size_accepted` is not set. When the size is unknown because git timed out or its output was too large, it prints one warning instead of the size and file count: "the Run size is unknown (git timed out or its output was too large), counted as over the limit". The commit-count warning stays.
- **Documents.** The Documents bullet, from the Sweep: `skills/factory/references/progress-commands.md` (the `transition` line, new `split` and `size`), `skills/factory/references/run-schema.md` (rows `size_accepted`, `tickets_done` and `tickets`), `skills/factory/references/define.md` (Size section, Run B), `docs/specs/reduce-check-loops.md` and ADR 0023 (the limit is no longer only a warning; pointer to ADR 0035), the command line help in `bin/tds-factory.js`, `docs/usage.md` (Run B), `docs/dashboard.md` (Run B), `GLOSSARY.md` (**Run size**, **Split**), a changelog fragment.
- **Not done.** The red-check is a later Run of its own and is not part of this one.

## Size estimate

The limit applies to this work as well. Per Ticket, as files and KB of diff (tests count; the Spec, ADR and Glossary count toward the Run that commits them):

| Part                                                                                                                                                                                                                       | Files        | KB           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------ |
| Define artifacts of Run A (this Spec, ADR 0035, Glossary)                                                                                                                                                                  | 3            | 12           |
| Ticket 1: measure with exclusions (`run-size.js`, `run-size.test.js`)                                                                                                                                                      | 2            | 5            |
| Ticket 2: wait, accept, split, commands (`run-record.js`, `run-lifecycle.js`, `run-events.js`, `run-store.js`, `bin/tds-factory.js`, `run-size-gate.test.js`, `run-schema.md`, `progress-commands.md`, changelog fragment) | 9            | 16           |
| **Run A total**                                                                                                                                                                                                            | **14**       | **33**       |
| Run B: Define and Fast track text, `SKILL.md`, Dashboard buttons and route, `docs/usage.md`, `docs/dashboard.md`, tests                                                                                                    | about 14     | about 28     |
| **Both Runs in one**                                                                                                                                                                                                       | **about 28** | **about 61** |

One Run would pass both limits, so the work is cut into two. The table is the original plan for Run A: it stays under the limit but close to the file count.

Run A as built: 16-17 files and about 57 KB including the Define artifacts, over the limit of 15 files and 40 KB; the user accepted that size. Lesson for Run B's estimate: tests and long Markdown lines were under-estimated, so count tests at their real size and Markdown lines by their length.

## Testing Decisions

- `test/run-size.test.js` (extended): lockfiles and `test/fixtures/` files are left out of the files and bytes, tests and other files count, uncommitted changes are not counted, an unknown base gives no size.
- `test/run-size-gate.test.js` (new, in a temporary repository like the other store tests): raising `tickets_done` over the limit with Tickets remaining waits with the reason and the update succeeds; no wait when under the limit, when the last Ticket is done, after accept, or in another Stage; `split` keeps the done Tickets, prints the moved links, releases and logs a `split` event; `size --accept` sets `size_accepted`, releases and logs; both refuse a Run that does not wait for size; `run update` refuses `size_accepted`; the transition prints the size warning, and does not after an accept; `run size` without `--accept` writes nothing.

## Out of Scope

The red-check; Dashboard buttons, Skill text for Define and the Fast track (Run B); measuring uncommitted work; refusing a transition on size; choosing the cut for the user.
