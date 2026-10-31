# Doctor finds Copilot Skills in the Claude and Codex folders

## Problem Statement

`tds-factory install` with no `--agent` writes the Skills to `~/.claude/skills` and `~/.agents/skills`, and the install guide says that is enough for Copilot because Copilot CLI reads both. But `tds-factory doctor --agent copilot` only looks in Copilot's own folders (`.github/skills`, `~/.copilot/skills`). A Copilot user who followed the guide gets `skills` and `review` failures, and `/factory` stops in Preflight, while plain `doctor` (which defaults to Claude) passes.

## Solution

For the Copilot Agent target, `doctor` counts a Skill as installed when it is in the Copilot, Claude or Codex Skill folder, in the project or in the home folder. Stage agents are still looked up only in Copilot's agent folders.

## User Stories

1. As a Copilot user who ran the default install, I want `doctor --agent copilot` to find my Skills, so that `/factory` does not stop in Preflight.
2. As a Copilot user with a Skill missing everywhere, I want doctor to still list it, so that the check stays meaningful.
3. As a Claude or Codex user, I want my checks unchanged, so that a Skill in another agent's folder does not hide a missing install.

## Implementation Decisions

- A `skillTargets(agent)` helper in `src/doctor.js` lists the Skill folders searched: Copilot gets Copilot, Claude and Codex; the others get only their own.
- No change to the Stage agent check or to `install`.
- `docs/usage.md` states which folders doctor searches for Copilot.

## Testing Decisions

- `test/doctor.test.js` installs the Skills into the Claude folder or the Codex folder only, runs `doctor --agent copilot` and expects `skills` and `review` to pass.
- Existing tests still show a missing Skill is listed and that other targets are unaffected.

## Out of Scope

Changing the default install target or the Copilot Stage agent folders.
