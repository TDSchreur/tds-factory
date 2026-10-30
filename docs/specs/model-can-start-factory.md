## Problem Statement

The `factory` Skill carries `disable-model-invocation: true`. Claude Code and Copilot in VS Code therefore start it only when the user types `/factory`, while Codex ignores the flag and may start it on its own. No ADR or doc records why the flag is there. The user wants the model to be able to start `factory` in every Agent target, so the flag is removed and the docs that describe the difference are out of date.

## Solution

Delete the `disable-model-invocation: true` line from `skills/factory/SKILL.md`. Replace the docs that say the agent never starts `factory` on its own with one plain statement: every Agent target can start `factory` itself, and `/factory` is how a user starts a Run on purpose. Delete the README "Known limitations" section, because its only entry no longer holds. Rewrite the changed doc text with the `unslop` Skill.

## User Stories

1. As a Factory user, I want the model to be able to start `factory` when I describe a feature end to end, so that I do not have to remember to type `/factory`.
2. As a Factory user, I want `/factory` to keep working as the explicit way to start a Run, so that nothing I do today stops working.
3. As a Factory user on Claude Code, Codex or Copilot, I want the docs to describe the same behaviour for all three, so that I am not told one agent differs when it does not.
4. As a Factory developer, I want a test that fails if the flag returns on `factory`, so that the Skill and the docs cannot drift apart again.

## Implementation Decisions

- Only `skills/factory/SKILL.md` changes in the Skill itself. The `description` stays as it is.
- `setup-matt-pocock-skills` keeps its flag. The docs name it as the other Skill that only runs when started, and that part of `docs/install.md` stays true.
- `skills/PROVENANCE.json` and `src/sync.js` are untouched. `factory` is a project Skill, not a synced one, and sync already removes the flag from the Skills that `factory` invokes.
- Docs to change: `README.md` (delete Known limitations), `docs/capabilities.md` (Skill invocation row), `docs/install.md` (the Copilot CLI, Claude Code and Codex bullet) and `docs/usage.md` (the starting-a-Run paragraph that says the agent never starts `factory` on its own).
- No change to `GLOSSARY.md` or the ADRs. The change is easy to reverse and has no new term.

## Testing Decisions

- The seam is the committed Skill file. The existing test "every skill the factory invokes can be called by the model" checks the Skills `factory` invokes. Extend it to cover `factory` itself, so it fails while the flag is present.
- The docs are covered by the existing guide tests (links, commands). No test pins the old wording.

## Out of Scope

- Narrowing the `factory` description.
- Changing how any other Skill is flagged.
- Changing the installer, `sync` or `doctor`.

## Further Notes

The flag exists since the first commit (`e598370`). My guess is it was meant to keep a Run, which creates a worktree, commits and opens a PR, from starting without a request. That guess is not recorded anywhere in the repo.
