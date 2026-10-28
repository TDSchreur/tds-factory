# Ask unless Check is clean

## Problem Statement

Today Check moves on to Finish without asking when the loop cap is reached with problems still open, and Finish only asks permission when the Infrastructure verdict is `fail`. A Run can therefore reach a prepared pull request with a failing Standards, Spec or Security axis, and I only find out by reading the Stage summaries.

## Solution

Only a clean Check continues to Finish without asking. If any Check axis fails, or the loop cap is reached with problems open, the Run sets itself to `waiting` and asks me for permission before Finish starts. One gate at the Check → Finish transition replaces the Infrastructure-only gate in Finish.

## User Stories

1. As a developer, I want a clean Check to continue to Finish without asking, so that a good Run is not slowed down
2. As a developer, I want the Run to ask me before Finish when any Check axis has failed, so that a failing change never reaches a prepared pull request unnoticed
3. As a developer, I want the Run to ask me before Finish when the loop cap is reached with problems open, so that a stubborn finding is a decision I make, not one the Run makes for me
4. As a developer, I want Infrastructure `fail` to be one case of the same gate, so that there is one rule for every axis and not a special one for Infrastructure
5. As a developer, I want an Infrastructure axis that is `skipped` to count as clean, so that a Run with no infrastructure files is not asked about something that did not run
6. As a developer, I want a missing verdict or a file that is "not validated" to count as `fail`, so that unreviewed or unvalidated work is never called clean
7. As a developer, I want LOW and INFO findings to be reported only and not make the Check unclean, so that I am not asked about findings the Run already judged not worth fixing
8. As a developer, I want problems worth fixing within the loop cap to keep going back to Build without asking, so that the Run fixes what it can before it bothers me
9. As a developer, I want the question to list the open axes and findings, so that I can decide without opening the Stage summaries
10. As a developer, I want to answer yes to continue to Finish, so that I can accept the open findings knowingly
11. As a developer, I want my yes recorded in `finish.md`, so that the decision to continue with open findings is traceable
12. As a developer, I want to answer no or stop to end the Run as `abandoned`, so that I can walk away from a change I do not trust
13. As a developer, I want the Run to be `waiting` with a reason while it asks, so that the Dashboard flags it as needing me
14. As a developer, I want the Run to go back to `running` as soon as I answer, so that the Dashboard shows the true state
15. As a developer, I want the README Flow diagram to show the gate, so that the documented Flow matches what the Run does
16. As a developer, I want the glossary to define a Clean Check, so that the term means the same thing in the skill, the README and the specs
17. As a developer, I want the older specs left as they are, so that they stay a record of what was true when they were written

## Implementation Decisions

- **One gate, in Check.** Check ends in one of two ways: clean, or not clean. Not clean sets the Run to `waiting` with a reason and asks for permission. Finish no longer has a gate of its own.
- **Clean.** Every axis verdict is `pass`; Infrastructure may be `skipped`. LOW and INFO findings do not count. A missing verdict, or Infrastructure "not validated", counts as `fail`.
- **Loops within the cap are unchanged.** While fewer than 2 loops have been used, problems worth fixing go back to Build automatically. The gate fires only when Check would otherwise move on: an axis that records `fail` without a problem worth fixing, or the loop cap reached.
- **The question.** It lists the open axes and findings. Yes continues to Finish and the decision is recorded in `finish.md`, in place of the Infrastructure "accept the risk" record. No or stop ends the Run as `abandoned`. There is no "one more loop" answer; the user can still redirect in free text.
- **Waiting on the user.** The Finish/infrastructure bullet is replaced by one Check bullet: any axis `fail`, or loop cap reached with problems open. The existing Check bullet for the loop cap is folded into it.
- **Finish.** It starts with the `pr` Skill. It no longer checks the `infrastructure` verdict before preparing the PR. The PR template's Infrastructure checklist is still filled in from the verdict.
- **README.** The Flow diagram edges become "clean" to Finish, and "not clean: ask first" to Finish, replacing "clean, or loop cap reached" and "infrastructure fail: ask first". The prose drops "Infrastructure is the one axis that blocks Finish" and describes the single gate.
- **Glossary.** **Check axis** no longer says Infrastructure is the only one that blocks Finish. **Clean** is a new term. Both are already done.
- **Older specs** (`project-aware-factory`, `security-review`, `dashboard`) are left unchanged as historical records.

## Testing Decisions

- A good test reads the `factory` Skill as the agent would and asserts on its external behavior: which conditions ask the user, which continue, what is recorded. It does not assert on exact prose beyond key terms.
- The seam is the `factory` SKILL.md, read by section in `test/skills.test.js`. This is the existing seam; no new one is added.
- Edit the test "Finish is blocked by an Infrastructure fail…" so it no longer expects a gate in Finish. It keeps the Infrastructure checklist, Documentation checklist and `skipped` assertions.
- Add a test for the Check gate: Check names the clean condition, says that any axis `fail` or a reached loop cap sets the Run to `waiting` and asks, requires an explicit yes, records it in `finish.md`, and treats a missing verdict or "not validated" as `fail`.
- Edit the "Waiting on the user" assertion to expect the new Check bullet and no Finish/infrastructure bullet.
- Prior art: the existing Infrastructure and Finish tests in the same file.

## Out of Scope

- Changing the loop cap of 2 or what counts as a problem worth fixing.
- A "one more loop" answer at the gate.
- Dashboard changes; it already flags `waiting` Runs.
- Rewriting the older specs.

## Further Notes

- After changing the skill, re-run `tds-factory install` so the installed copy is updated.
- No ADR: the change is easy to reverse.
