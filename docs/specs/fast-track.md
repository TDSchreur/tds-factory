# Fast track

## Problem Statement

Every piece of work walks the full Flow: an interview, a multi-page Spec and several Tickets. For a bug fix or a tiny change that is more ceremony than the work needs. This is [GitHub issue #247](https://github.com/TDSchreur/tds-factory/issues/247), in milestone v0.5.0.

## Solution

Add a Fast track next to the existing Full track. On the Fast track Define is short: one confirmation instead of the interview, a one-paragraph Spec and exactly one Ticket, and a bug goes through `diagnosing-bugs` first. Check keeps at least the Standards and Security axes. The track is chosen explicitly by the user, or recommended by Define and confirmed by the user; it is never applied silently. Only a clean Check goes on to Finish without asking, on both tracks.

## User Stories

1. As a user, I want to name the Fast track when I start a Run, so that a one-line fix does not get the full interview.
2. As a user, I want Define to recommend the Fast track for work that looks small, and to apply it only after I confirm, so that I never get a lighter Flow without agreeing.
3. As a user, I want a Run without a recorded track to be a Full track Run, so that existing Runs and callers behave as before.
4. As a user on the Fast track, I want a single confirmation in Define, so that a one-line bug fix reaches Build quickly.
5. As a user on the Fast track, I want a one-paragraph Spec and exactly one Ticket, so that the Run still has a Spec link and a Ticket to close.
6. As a user with a bug, I want the work to go through `diagnosing-bugs` before the Spec, so that the fix targets the cause.
7. As a user on the Fast track, I want Standards and Security always reviewed and required, so that a lighter Flow does not skip the checks that protect the code.
8. As a user on either track, I want a Run that is not clean to need my explicit acceptance before Finish, so that the Fast track cannot weaken the gate.
9. As a user, I want the track recorded in `run.json` and shown on the Dashboard card, so that I can tell the tracks apart at a glance.
10. As a user, I want Run metrics split by track, so that I can compare Fast and Full Runs.
11. As a maintainer, I want an eval scenario where a one-line bug fix goes from `/factory` to a PR with one confirmation in Define, so that the Fast track is tested against a real agent.

## Implementation Decisions

- The name is Fast track; the default is Full track. A record with no `track` is a Full track Run. Neither is inferred from the work. See [ADR 0015](../adr/0015-fast-track-is-chosen-explicitly-and-keeps-the-check-gate.md).
- `run.json` gets `track`: `fast` or `full`. Only a new named operation, `tds-factory run track --id ID --value fast|full`, sets it, and only in Define. `run start` and `run update` reject it, so the choice is explicit and the record cannot change track after Define.
- `run track` records a choice the user made. The factory Skill says to call it after the user names the track or confirms Define's recommendation, never on Define's own judgment.
- Build refuses a Fast track Run unless it has exactly one Ticket. The Full track rule (a Spec link and at least one Ticket) is unchanged.
- The Standards and Security verdicts are required on both tracks. On the Fast track the Spec verdict may also be `skipped`; on the Full track it still may not. Infrastructure keeps its rule. The Finish gate stays one rule for both tracks: a clean Check or an Accepted one. `skipped` on a worktree with uncommitted changes stays refused.
- The track is shown in `tds-factory run stats` for each Run. `run stats --all` adds the observed totals and first-pass clean rate per track, with Runs that have no track counted as Full. The Dashboard Run detail shows the same track. This fills the track dimension [ADR 0013](../adr/0013-run-metrics-preserve-observed-history.md) left open.
- The Dashboard card shows the track as a row of its facts list, `Fast` or `Full`.
- The factory Skill, the Stage agents, `README.md` and `docs/usage.md` describe the track. The Skill invokes `diagnosing-bugs`, so that Skill is added to the shipped set (`skills.manifest.json`, `skills/`).
- `GLOSSARY.md` names Track, Fast track and Full track. A changelog fragment is added.
- Out of scope: choosing the track by size or by label automatically, a Fast track for Follow-up Reworks beyond what the existing Follow-up does, changing the Check loop limit.

## Testing Decisions

- Drive the public Run store and CLI with temporary git repositories, as in `test/run-gates.test.js` and `test/run-cli.test.js`. Assert persisted records and refusals, not helper names.
- Cover: `run track` in Define and its refusal outside Define or for an unknown value; `track` rejected by `run start` and `run update`; a Fast Run with zero or two Tickets refused at Build; Standards and Security missing or failing on a Fast Run refused at Finish; Spec `skipped` accepted only on Fast; an unclean Fast Check refused at Finish until accepted.
- Cover `run stats` per-track totals, including a legacy Run counted as Full, and the track on the Dashboard card and Run detail with the existing browser fixture.
- The skills and doc tests keep the Skill, the agents and the docs in agreement; `diagnosing-bugs` is added to the expected invoked list.
- The eval scenario is graded on the recorded Run: track `fast`, one Ticket, one question to the user in Define, a PR recorded.
