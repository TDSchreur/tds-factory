# Dashboard: grant an extra Check loop

## Problem Statement

A Run that has used up its Check loops (four by default) and still has Blocking findings stops and waits for permission to continue to Finish. The only other choice is to abandon it. A user who wants one more Rework has no way to give it. This is the fourth item of the Dashboard work in milestone v0.6.0.

## Solution

Let the user grant one extra Check loop from the Dashboard, only for a Run that waits on them in Check at its loop limit. It is a manual, user-only action: one loop per click, no ceiling, recorded in the Run record and in the Event log, and never available to an agent through the command line. The design is in [ADR 0024](../adr/0024-the-user-can-grant-an-extra-check-loop.md).

## User Stories

1. As a user, I want a "Grant extra loop" button on the card and in the detail of a Run in Check that waits on me at its loop limit, so that I can allow one more Rework.
2. As a user, I want the button to ask for confirmation and to say what it does, so that I do not grant a loop by accident.
3. As a user, I want the button hidden for every other Run (not in Check, not waiting on me, not at the limit), so that it only shows when it can work.
4. As a user, I want each click to add exactly one loop and no limit on the number of clicks, so that I stay in control.
5. As a user, I want the Check loops row of the facts list to show the new limit ("4/5"), so that I see what I granted.
6. As a user, I want the grant in the Event log and the timeline ("Extra Check loop granted, limit now 5"), so that the Run history shows it.
7. As a user, I want a click on a page that is out of date to be refused, so that I never grant a loop for a Run I did not see.
8. As a user, I want `tds-factory run rework` to accept the Run after the grant, and Follow-up to use the same limit, so that the extra loop is usable.
9. As a user, I want the Run back to running after the grant, with the agent told in the chat as with Accept, and the Skill saying a raised limit is my decision to go back to Build, so that the agent does the Rework instead of asking again.
10. As a maintainer, I want no command-line way and no `run update` way to raise the limit, so that an agent cannot grant itself a loop, and I want a test that a request without the session token is refused.

## Implementation Decisions

- The Run record gets `extra_loops`, a whole number from 0, absent meaning 0. Only the store's `grantLoop` changes it; `run update` refuses it like the other gated fields. It is in the field table of the run schema reference.
- `loopCap(record)` is the frozen cap (never above the Factory maximum of 4) plus `extra_loops`. `reworkRun`, Follow-up and the Dashboard Check loops row already use `loopCap`, so they follow. The stored `check_loops` is no longer capped at 4 by validation; the Rework operation enforces the cap.
- `grantLoopRun(projectDir, id, { updated })` runs under the Run lock and refuses unless the Run is in Check, its status is `waiting` and it waits on the user, and `check_loops` is at or above `loopCap`. When `updated` is given it must equal the record's `updated`. It adds one to `extra_loops`, sets the Run to `running` with the waiting fields cleared and the activity "The user granted an extra Check loop on the Dashboard". The Event log gets an `extra-loop` event (`granted` holds the new count) next to the `released` event the change already produces.
- `POST /api/runs/<id>/extra-loop?updated=<time>` calls it behind the existing write guard (Origin, Host and session token, ADR 0017). A refusal is HTTP 409 with the reason. There is no CLI command.
- The page shows the button when `column` is `check`, the Run waits and `loops >= loopCap`.
- The Skill (Check section and `references/check.md`) says: when the limit has been raised since the agent asked, the user has decided to go back to Build once more, so run `tds-factory run rework` and do not ask again. The statements of the limit in the docs, README and glossary add "unless the user grants an extra loop".
- GLOSSARY.md gets **Extra loop**. `docs/dashboard.md`, `docs/usage.md`, `docs/capabilities.md` (the limit of the guard) and a changelog fragment are updated.

## Testing Decisions

- Store tests (`test/run-extra-loop.test.js`): the grant at the limit, each refusal (not Check, not waiting, below the limit, stale `updated`), repeated grants without ceiling, `rework` after a grant, Follow-up using the raised limit, `run update` refusing `extra_loops`, old records without the field, the event, and a check that no command-line command grants a loop.
- Server tests: the route succeeds with the token, is refused (403) without the token or with a foreign Origin, and answers 409 for each ineligible Run.
- Browser tests: the button's visibility rule, the confirmation, the request with the token and `updated`, the Check loops row, and the refusal dialog.

## Out of Scope

Granting from the command line or by an agent, Follow-up Runs, a ceiling or a confirmation phrase, automatic grants.
