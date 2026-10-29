## Problem Statement

The Prepare Stage has no work of its own since the smaller-option instruction moved into Build. Runs still pass through it, the Dashboard shows an always-empty column for it, and the docs explain a Stage that does nothing.

## Solution

The Flow has four Stages: Define, Build, Check and Finish. A Run moves from Define straight to Build, the Dashboard has no Prepare column, and the skill, agents, README and guides no longer mention Prepare. A Run recorded before this change at `prepare` is read as `define`, so it still moves on and shows in a column.

## User Stories

1. As a Factory user, I want the Flow to have only Stages that do work, so that I do not wait on or explain an empty Stage.
2. As an agent following the `factory` Skill, I want to move from Define to Build with one transition, so that no step is a no-op.
3. As a Factory user watching the Dashboard, I want columns Define, Build, Check, Finish and Done, so that every column means something.
4. As a Factory user with an older Run recorded at `prepare`, I want it to keep working, so that I do not repair records by hand.
5. As a Factory user, I want `run transition --to prepare` refused as an unknown Stage, so that I do not move a Run into a Stage that no longer exists.
6. As a reader of the README and guides, I want the Stage list, diagram and model table to match the Flow, so that the docs are not stale.
7. As a Factory user, I want the `factory-define` agent described as the Define agent only, so that its role is clear.
8. As a maintainer, I want the archived specs left alone, so that history stays as it was written.

## Implementation Decisions

- The ordered Stage list loses `prepare`. Transition order, Stage validation and the Dashboard columns follow from that list.
- A stored Run whose stage is `prepare` is read as `define` in the Run store and on the Dashboard. No file on disk is rewritten. The next move to Build still needs the Spec link and Tickets.
- The `factory` Skill drops the Prepare section and Prepare from its description, transition usage, stage field values and Stage agents text. The CLI usage line drops `prepare`.
- The `factory-define` agent descriptions and the README model table say Define only. Models and efforts do not change.
- The Dashboard drops the Prepare column help text and the Prepare entry in its explanations.
- The Glossary Stage definition is already updated to Define, Build, Check or Finish.
- The README diagram, Stage results text and table, and the usage guide's diagram, Stage list, Dashboard columns and glossary table drop Prepare. Where the guide says Prepare leaves no summary, that sentence goes.
- No ADR: the change is easy to undo and has no real trade-off. `docs/specs/archive/` is not edited.

## Testing Decisions

- Test external behavior only. The highest seam is the `tds-factory` CLI against a temp project, as the run-gates tests already do, plus the Dashboard page test.
- Run gates: Define moves to Build; moving to `prepare` is refused; a Run whose `run.json` says `prepare` can move to Build once it has the Spec and Tickets.
- Dashboard: a Run recorded at `prepare` shows in the Define column; the page has no Prepare column.
- The skills test asserts the Flow has no Prepare section and the Stage list is Define, Build, Check, Finish. The eval fixture goes straight from Define to Build.
- Prior art: `test/run-gates.test.js`, `test/dashboard-page.test.js`, `test/skills.test.js`.

## Out of Scope

- Rewriting existing `run.json` files or old `prepare.md` summaries.
- Changing models, efforts or any other Stage.
- Editing archived specs.

## Further Notes

Follows PR #179, which moved the smaller-option instruction into Build and left Prepare as a Stage with no work.
