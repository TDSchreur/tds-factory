# Run flow enforcement and evidence

## Problem Statement

The Run record accepts any valid-looking change, so it cannot tell whether the Flow was followed. A Run can enter Build with no Spec or Tickets, enter Finish with a failed Check axis, be marked done with Tickets that never existed, or be reopened after it is done. Verdicts and the Verify command are stored with no link to the code they were produced for, so an earlier `pass` stays in the record after new commits land. Nothing tells a person whether a stalled Run is healthy, there is no pull request check in CI, and a few documentation and sync leftovers disagree with the glossary.

## Solution

Moving a Run forward becomes a set of named Run store operations that check their prerequisites, while ordinary updates stay cheap for activity, links and counters. Every verdict and Verify result is recorded as Evidence tied to the code revision it was produced for, and Finish needs current Evidence or an explicit Accepted Check. A read-only inspection reports what is wrong with a Run. Pull requests get their own CI run, and the small documentation and sync leftovers are fixed.

## User Stories

1. As an agent, I want to move a Run to Build only when a Spec and Tickets are recorded, so that I cannot build without a definition of the work.
2. As an agent, I want a rejected transition to say what is missing, so that I can fix it without guessing.
3. As an agent, I want to move a Run to Check only after Build, so that the Stages stay in Flow order.
4. As an agent, I want to move a Run to Finish only with a clean Check or an Accepted Check, so that a failed axis cannot slip through.
5. As an agent, I want a single command that runs the Verify command in the Run worktree and records the result, so that a pass is an observed fact and not my own statement.
6. As an agent, I want the Verify result to record the command, directory, revision, exit code, start and end times and an output log, so that a reviewer can check what ran.
7. As an agent, I want a Verify result from an uncommitted tree to be marked as such, so that it cannot be taken as proof for the committed code.
8. As an agent, I want to record each Check axis verdict through a command that stamps the current revision and Check attempt, so that verdicts say which code they reviewed.
9. As an agent, I want a verdict to be refused for a dirty worktree when it would pass, so that reviews describe committed code.
10. As an agent, I want a Rework command to send a Run from Check back to Build, so that the loop limit and the clearing of old Evidence happen together.
11. As an agent, I want Rework to be refused after the second return to Build, so that the loop stays bounded.
12. As an agent, I want Rework to clear verdicts, the Verify result and any Accepted Check, so that stale Evidence cannot be reused.
13. As an agent, I want an accept command that stores the open findings, the decision and the reviewed revision, so that a user-approved non-clean Check is recorded explicitly.
14. As an agent, I want an Accepted Check to stop counting once the code changes, so that approval for one revision does not carry over to another.
15. As an agent, I want a complete command that marks a Run done only at Finish with a pull request link, so that done always means a PR exists.
16. As an agent, I want to update activity, links, summaries and counters without ceremony, so that progress notes stay cheap.
17. As an agent, I want `run update` to reject Stage changes, `done`, the loop count and the verdicts, so that the gates cannot be skipped by accident.
18. As a user, I want to stop a Run at any time, so that `abandoned` and `waiting` still work through an ordinary update.
19. As a user, I want a done or abandoned Run to stay that way, so that history is not rewritten by an ordinary update.
20. As a user, I want the Run worktree path and base commit to be set only when the Run starts, so that a record cannot point at someone else's checkout.
21. As a user, I want the Run record to remember the commit the Run branched from, so that later reviews have a fixed starting point.
22. As a user, I want older Run records without the new fields to stay readable, so that history and the Dashboard keep working.
23. As a user, I want the Dashboard to keep loading Runs with missing or unknown fields, so that upgrading does not hide my history.
24. As a user, I want one command that inspects Runs without changing anything, so that I can see what is wrong before I fix it.
25. As a user, I want the inspection to report records that cannot be parsed, so that a damaged Run does not hide silently.
26. As a user, I want the inspection to report a lock file left behind, so that I can tell a stuck Run from a busy one.
27. As a user, I want the inspection to report a missing worktree or one git does not know, so that I know the Run cannot continue.
28. As a user, I want the inspection to report a worktree with uncommitted changes, so that I do not remove one by mistake.
29. As a user, I want the inspection to report stale Evidence, so that I know a review must be repeated.
30. As a user, I want the inspection output as JSON when I ask for it, so that other tools can use it.
31. As a user, I want the Factory Skill to create the Run before it marks it waiting for a missing Verify command, so that its instructions never refer to a record that does not exist.
32. As an agent, I want the Factory Skill to name the new commands, so that installed copies drive the gated operations.
33. As a maintainer, I want every pull request tested in CI before merge, so that a broken change is caught early.
34. As a maintainer, I want CI to use the latest LTS Node release, so that the supported runtime stays current.
35. As a maintainer, I want a CI job that installs a browser and fails when the browser tests are skipped, so that skipped coverage is visible.
36. As a maintainer, I want the unit tests to fail when a gate is bypassed, so that the Flow rules are proven by behavior and not by matching text.
37. As a maintainer, I want sync to remove a marked Skill copy that is no longer in the manifest, so that obsolete Skills are not shipped.
38. As a maintainer, I want sync to leave Skills without the upstream marker alone, so that locally written Skills survive.
39. As a contributor, I want the domain guide to call Claude, Codex and Copilot Agent targets, so that it agrees with the glossary.
40. As a colleague, I want to be told to run `tds-factory install` again after an upgrade, so that my installed Skill uses the new commands.

## Implementation Decisions

- The Run store stays the only module that touches Run records. It gains the operations transition, rework, verify, verdict, accept and complete, plus a read-only inspection. The CLI exposes them as `run transition`, `run rework`, `run verify`, `run verdict`, `run accept`, `run complete` and `run inspect`. The Dashboard keeps reading records through the store and does not change.
- Reading stays lenient and writing becomes strict. Records without the new fields stay valid; operations that need a field treat a missing one as absent Evidence.
- Ordinary update keeps accepting activity, summary links, the Ticket counters, `spec_link`, `tickets`, `pr`, `waiting` fields, `abandoned` and the existing text fields, except that the Verify command can be set only while it is empty, so Evidence cannot come from a swapped command. It rejects `stage`, `status` values `done` and `running` after `done`, `check_loops`, the four verdicts and the new evidence fields. Setting `running` after `waiting` stays allowed. Records that are `done` or `abandoned` accept no update that changes their status.
- Start records the base commit of the fresh origin default branch next to the worktree path. Both are owned by the store and cannot be set by update.
- Transition to Build requires `spec_link` and a non-empty `tickets` list. Transition to Check requires the Run to be in Build with every counted Ticket done. Transition to Finish requires the Run to be in Check and either a clean Check or an Accepted Check, both bound to the current head. Transition from Define to Prepare and Prepare to Build follow Flow order and do not skip Stages.
- A clean Check means all four verdicts are recorded for the current head and attempt, each `pass` (Infrastructure may be `skipped`), plus a Verify result for the current head with exit code 0, produced by the Run's own Verify command, that was taken in a clean worktree.
- Verify runs the recorded Verify command from the Run worktree through the shell, captures the output to a log file in the Run folder, and writes a Verify result with command, directory, head, whether the tree was dirty, exit code and start and end times. A failing command still records its result; only success counts as Evidence.
- A verdict is stored with the head and the Check attempt. A `pass` or `skipped` on a dirty worktree is refused. A `fail` may be recorded on a dirty worktree.
- Rework is allowed only from Check, raises the loop count, moves the Run to Build and clears verdicts, the Verify result and any Accepted Check. It is refused when the loop count is already 2.
- An Accepted Check holds the findings, the decision, the reviewed head and a time. It counts only while the head is unchanged.
- Complete requires Stage Finish and a `pr` link, sets `done` and never allows ticket counts to exceed the total. Complete does not run when the Run is already finished.
- Inspect reads every Run and reports: unparseable record, lock file present, worktree path missing, worktree unknown to git, worktree with uncommitted changes, and Evidence whose head differs from the current head. It reports and never repairs, and it exits successfully either way.
- The Factory Skill is rewritten to use the new commands and describes the Evidence rules in its Check and Finish sections. The Preflight text creates the Run, with an empty Verify command, before it is marked waiting for that command. The test for the Skill text is updated.
- A pull request workflow runs the project's tests on the latest LTS Node release on Ubuntu, in addition to a browser job that installs Chromium and fails if the browser tests are skipped. The release workflow is unchanged.
- Sync removes marked Skill folders that are no longer in the manifest, and never removes unmarked ones.
- ADR 0006 records the move to named transitions, and the glossary gains Verify result, Evidence, Accepted Check and Rework. The domain guide uses Agent target.

## Testing Decisions

- A good test drives behavior from the outside: run the CLI against a real temporary git repository, then read the Run record and files it leaves behind. Tests do not assert internal helper names or the exact text of messages beyond naming the missing item.
- The highest seam is the `tds-factory run` command line, backed by the real Run store and real git. A thin layer of Run store tests covers the same behavior with direct calls where a CLI process is not needed.
- Negative tests are the point: each gate has a test that tries the forbidden move and checks that the record is unchanged. Cases are Build without Spec, Build without Tickets, Finish with a failed axis, Finish with stale Evidence after a new commit, Finish with a dirty worktree, Rework at the limit, an Accepted Check after the head changed, updating a done Run and updating the gated fields.
- Compatibility tests load an old-shaped record and confirm the Dashboard and the store still read it.
- Inspect is tested with prepared fixtures: a malformed record, a stray lock, a missing worktree, a dirty worktree and stale Evidence.
- Sync is tested with a temporary manifest and skills folder as in the existing sync tests.
- The workflow files are checked by a contract test, as the release workflow is. Their execution cannot be validated locally.
- Prior art: the Run store tests, the Run CLI tests, the Run worktree tests with their git fixture helper, the sync tests and the release workflow contract test.

## Out of Scope

- The Dashboard merge action was handled separately in the Dashboard merge Evidence Spec.
- Repair and recovery, lock ownership and cleanup when start fails midway were deferred here; the follow-up [Explicit Run recovery](run-recovery.md) Spec now defines that behavior, including distinct non-human pause statuses. Its additions supersede this exclusion.
- Changes to how composed Skills behave, the agent capability matrix and agent evaluations.
- Transactional install and sync, local edit detection and the provenance inventory.
- Sandboxing the Verify command; the project still owns that trust decision.
- Rewriting older Run records into the new shape.

## Further Notes

- Installed copies of the Factory Skill that still call `run update` for the gated fields will fail until `tds-factory install` is run again; this is the cost recorded in ADR 0006.
- LICENSE, the third-party notices and the README source count were already correct on the current default branch.
- The follow-up prompts for the deferred work are kept in the user's notes.
