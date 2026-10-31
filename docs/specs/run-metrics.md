# Run metrics

> Superseded in part by [ADR 0015](../adr/0015-fast-track-is-chosen-explicitly-and-keeps-the-check-gate.md) and [the Fast track Spec](fast-track.md): the track is now recorded in the Run record (absence means Full) and `run stats --all` splits by track. The statements below about leaving the track unspecified describe the original scope.

## Problem Statement

The Run record shows current progress and Evidence but does not preserve Stage timings or Check verdicts that Rework and Run sync clear. A user cannot compare time per Stage, count Reworks alongside that time, or tell how often the first Check finishes clean. This is [GitHub issue #245](https://github.com/TDSchreur/tds-factory/issues/245), in milestone v0.5.0.

## Solution

Record Run metrics through the existing named Run operations. Add `tds-factory run stats --id ID` for one Run and `tds-factory run stats --all` for all Runs, and show the same per-Run summary in Dashboard Run detail. Preserve old records and show `no data` when a metric was not observed. State explicitly when tokens and cost are not tracked.

## User Stories

1. As a user, I want Stage start and end timestamps recorded automatically, so that timings describe observed transitions.
2. As a user, I want repeated Build and Check visits preserved and summed per Stage, so that Rework time is included.
3. As a user, I want ongoing Stage time labeled as ongoing and waiting included in elapsed time, so that I understand what the timing means.
4. As a user, I want completion and abandonment to close the current Stage visit, so that terminal Runs stop accumulating time.
5. As a user, I want the Rework count beside Stage timings, so that I can see the cost of returning to Build.
6. As a user, I want chronological baseline and Project review verdict history to survive Rework and Run sync, so that earlier Check results remain available.
7. As a user, I want first-pass clean rate to count only observed first Check outcomes, so that unfinished and legacy Runs do not skew the result.
8. As a user, I want one-Run stats and all-Run stats, so that I can inspect individual work and the project together.
9. As a Dashboard user, I want the same metrics summary in Run detail, so that I can inspect it without a terminal.
10. As a user with old Run records, I want missing metrics to show `no data`, so that upgrading keeps history readable without inventing measurements.
11. As a user, I want tokens and cost shown only when the Agent target exposes them, and otherwise explicitly marked not tracked, so that unknown usage is never reported as zero.
12. As a maintainer, I want the metrics representation to leave room for a future track dimension, so that a Fast track can later be compared without rewriting the history model.

## Implementation Decisions

- The Run store remains the owner of persisted metrics and the public interface used by the CLI and Dashboard. Reading remains tolerant; writing metrics is owned by named operations under the same lock and atomic write as the progress they describe. Ordinary updates cannot supply or replace metrics. The existing update that abandons a Run closes its active visit.
- A newly started Run records a Define visit at start. Successful Stage transitions close the current visit and open the next at one timestamp. Rework closes Check, opens another Build visit and increments the existing authoritative Rework count. Complete closes Finish. Waiting, interruption and unavailable verification do not split or pause a visit: elapsed time is wall-clock time, including those intervals.
- Preserve individual Stage visits, their UTC start and optional end timestamps, and Check attempt context where relevant. Sum completed visits and the elapsed portion of the current open visit per Stage. Label ongoing values. A Stage with no recorded visit has `no data`, not zero. Do not derive missing historical visit boundaries from a record's creation or update timestamps.
- Preserve an append-only chronological history of successfully recorded baseline and Project review verdicts, including axis, value, UTC timestamp, reviewed head and Check attempt; Project review events also retain the recorded base. Re-recording an axis preserves both events. History is descriptive and never counts as current Evidence. Rework and Run sync keep history while retaining their existing Evidence invalidation rules.
- Persist the first Check outcome when the Run leaves its first Check by Rework or Finish. Rework is unsuccessful. Finish is successful only when the Check is clean under the existing Evidence rules; a Finish allowed through an Accepted Check that is not independently clean is unsuccessful. Merely recording a verdict does not resolve the first Check. A later clean Check does not change a failed first outcome.
- First-pass clean rate is successful first Check outcomes divided by all observed first Check outcomes. Show numerator and denominator with the percentage. Exclude unresolved first Checks and records lacking the history needed to establish an outcome; show `no data` when the denominator is zero. For one Run this is 1/1, 0/1 or `no data`.
- One-Run stats print time per Stage, Reworks and first-pass clean rate. All-Run stats print the per-Run summaries and project totals for observed Stage time and Reworks, plus the aggregate first-pass clean rate. Identify missing or unreadable data rather than treating it as zero. Stats are read-only, work from the main checkout or a linked worktree, and need no Agent session, git worktree or GitHub connection to calculate recorded values.
- Dashboard Run detail uses the same calculations and labels as the CLI, including `no data`, ongoing time and usage availability. No separate analytics page or verdict-history viewer is required.
- Legacy Runs remain readable and are not migrated or backfilled. Their missing metrics show `no data`; later operations must not invent earlier visits or first Check outcomes. Existing recorded Rework counts remain intact, but a missing count is unknown. Malformed optional metrics must not make an otherwise readable Run disappear or crash the Dashboard.
- The current Factory integrations do not expose Agent token or cost measurements to the Run store. Explicitly show `Tokens: not tracked` and `Cost: not tracked`; do not estimate from time, model names or prices. Keep availability explicit in the representation so a future integration can supply observed measurements.
- Keep the metrics representation versioned and leave an optional track dimension whose absence means unspecified. Do not infer a track for old Runs, add a Fast track, add a track selector or split the current output by track. This follows [ADR 0013](../adr/0013-run-metrics-preserve-observed-history.md) and extends [ADR 0006](../adr/0006-run-progress-goes-through-named-transitions.md).
- Update the usage and Dashboard guides, the glossary, the Factory Skill's Run record schema and a changelog fragment so the documented record and commands agree with the implementation.

## Testing Decisions

- Prefer the existing public Run store and CLI seams with temporary git repositories and real named operations. Assert persisted timestamps, retained visits and verdicts, printed statistics and unchanged records after refusals, rather than private helper names or incidental formatting.
- Cover start, forward transitions, repeated Build/Check through Rework, complete, abandonment, waiting and a current ongoing visit. Use controlled timestamps for exact duration assertions without sleeps.
- Exercise baseline and Project review verdict history, re-recorded verdicts, Run sync and Rework, and prove historical verdicts do not restore cleared Evidence.
- Cover clean first Finish, first Rework followed by eventual clean Finish, Accepted nonclean first Finish, unresolved first Check, zero eligible Runs and mixed legacy/new records. Check the displayed numerator and denominator as well as the rate.
- Drive the CLI for one Run and all Runs, missing IDs and conflicting selection options. Verify stats leave records unchanged and can read a completed Run with no worktree.
- Use the existing Dashboard browser fixture to open Run detail and verify the visible summary for measured and legacy Runs. Keep malformed optional metrics readable and verify token/cost wording.
- Run the repository Verify command after implementation. Prior art is the Run gates, CLI, Run sync, Project review and Dashboard detail browser tests.

## Out of Scope

- Fast track behavior, new Stages, track selection or filtering, Follow-up work and project configuration.
- Agent session-log scraping, token estimates, pricing tables, cost estimation or integrations that do not already expose usage to the Factory.
- Backfilling or migrating old records, changing Evidence or review gates, analytics charts, exports, a verdict-history UI and new Dashboard routes unrelated to Run detail metrics.
- Changing Rework limits, repairing Runs, deleting Runs or changing clean-up behavior.

## Further Notes

Keep this work within issue #245. The PR body must include `Closes #245` beside its Ticket lines, as well as closing any child Ticket created from this Spec.
