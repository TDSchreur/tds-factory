# Every agent follows /factory through

[GitHub issue #274](https://github.com/TDSchreur/tds-factory/issues/274), milestone v0.6.0 (foundations). Agents sometimes shortcut the Flow: they skip Define because a task looks small or already detailed, skip the Check reviewers or `unslop`, or bypass the Run record when a transition refuses. Until now the rule lived only in one user's private note for Claude. It must be a property of the Factory for Claude, Codex and Copilot.

## Behavior

- The `factory` Skill's `## Invoked Skills` contract states: detailed instructions do not replace Define; never skip a Stage; never work around a refused transition or edit `run.json` directly; if something blocks a Stage, stop and tell the user.
- The same rule is in all six Stage agents (define, build, check, finish, follow-up, interactive-check) of all three targets (`agents/claude`, `agents/codex`, `agents/copilot`), in one short sentence each.
- Two eval scenarios: `small-task-define` (a small, fully specified task still goes through Define: a Spec file in `docs/specs/` and a Ticket exist before any code changes) and `refused-transition` (a transition that the Run store refuses is not bypassed: the Run record is not edited directly and the Run does not advance).
- A cheap detectable bypass signal is surfaced only if simple; otherwise it is recorded as a follow-up in the PR.
- `docs/capabilities.md` says honestly that an agent which ignores Skills entirely cannot be forced; the Factory only makes the rule explicit and checkable.

## Test seams

Text pins in `test/skills.test.js` and the agent tests (the rule is present in the Skill and every agent file of every target); eval scenario graders through `test/eval-harness.test.js` with scripted stand-ins, so a broken grader cannot report a false pass; the name check for eval scenarios in `npm test`.

## Out of scope

Forcing an agent that ignores Skills; changing any command or Run record field.
