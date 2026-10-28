# Run worktrees

## Problem Statement

A developer who opens several agent tabs in one repo (Claude in one, Codex in another) has them all sharing one working tree and one current branch. A `git switch` in one tab changes the files under the others, and Define edits `GLOSSARY.md`, `docs/adr/` and `docs/specs/` before Build starts, so the clash begins early. The Run store is also per checkout, so Runs started elsewhere would be invisible to a Dashboard.

## Solution

Every Run gets its own Run worktree: a git worktree on a branch named after the Run id, created by `run start`. The Run store always lives in the main checkout, so one Dashboard shows every Run, wherever its agent works. Deleting a Run's history removes its Run worktree, and refuses if the worktree has uncommitted changes.

## User Stories

1. As a developer, I want each Run to work in its own worktree and branch, so that agents in different tabs never change each other's files.
2. As a developer, I want `run start` to create the worktree and branch and print where they are, so that I don't set them up by hand.
3. As a developer, I want the branch named after the Run id and cut from the default branch, so that I can tell which branch belongs to which Run.
4. As a developer, I want worktrees under `.factory/worktrees/<run id>`, so that they are already gitignored and sit next to the Run folder.
5. As a developer, I want `run start` from inside a linked worktree to adopt that worktree, so that I can open my agent in a worktree I made myself.
6. As a developer, I want `run update` to work from inside a worktree and write to the same Run store, so that the agent doesn't need to know where the main checkout is.
7. As a developer, I want one Dashboard in the main checkout to show Runs from every worktree, so that I see all agents at once.
8. As a developer, I want the Run record to hold the worktree path, so that I can find where a Run works.
9. As a developer, I want `run start` to fail with a clear message when the project is not a git repository or has no commits, so that isolation is never silently dropped.
10. As a developer, I want finished Runs to keep their worktrees, so that I can inspect or continue the work.
11. As a developer, I want deleting a Run's history to remove its worktree, so that cleanup is one action.
12. As a developer, I want that removal refused when the worktree has uncommitted changes, so that no work is lost silently.
13. As a developer, I want branches never deleted, so that a PR's commits and unpushed work survive cleanup.
14. As a developer, I want a refused removal reported in the Dashboard and the Run history kept, so that I know what to fix.
15. As an agent, I want the `factory` skill to tell me to work inside the Run worktree, so that my edits and commits land on the Run's branch.
16. As an agent, I want the skill to tell me to run the project's normal setup in the worktree when the verify command fails for missing dependencies, so that a fresh worktree doesn't block me.
17. As a developer, I want the README, glossary and skill to describe the new layout, so that the documented behaviour matches the tool.

## Implementation Decisions

- The Run store locates the main checkout through git's common directory and keeps `.factory/runs` there, whether it is called from the main checkout or from a linked worktree. The existing symlink and lock protections apply to that location.
- `start` creates the worktree and a branch named after the Run id, off the default branch, under the main checkout's `.factory/worktrees/<run id>`, and records its path in a new `worktree` field on the Run record. Run ids are unique among Run folders, and a free id is also skipped when a branch of that name exists, since branches outlive Run history. The CLI prints the Run id as today, so the path is read from the record or reported next to it.
- When `start` runs inside a linked worktree, it adopts that worktree: it creates no new worktree or branch and records the current one.
- `start` fails with a clear error, creating no Run folder, when the project is not a git repository or has no commits. There is no fallback to working in place.
- `remove` also removes the Run's worktree with a plain `git worktree remove` (never forced). If git refuses (uncommitted changes), `remove` keeps the Run history and returns a distinct result the Dashboard shows as an error. A Run with no recorded worktree (older records) is removed as before. Branches are never deleted.
- Existing `remove` eligibility rules (terminal status, readable record, no symlinks, no held lock) are unchanged.
- The Dashboard resolves its Run store the same way, so it works from the main checkout and shows Runs from every worktree. Its delete control surfaces the refused-removal error.
- `worktree` joins the Run record schema as an optional string, and the Run store validates it like other string fields.
- The `factory` skill creates the Run first, then works inside the Run worktree from Define onward. Its "start on a branch at Build" step goes, since the branch already exists, and it adds the dependency-setup advice. The committed skill copy is the one that changes; `install` is re-run afterwards.
- `GLOSSARY.md` gains **Run worktree** and an updated **Run store** entry, and ADR 0002 records the decision (both already written). The README describes the layout and the Dashboard's new behaviour.
- Dependencies are not installed by the Factory.

## Testing Decisions

Good tests check external behaviour only: what the store, CLI and Dashboard do to disk and git, not how they do it.

- **Run store** (existing seam, used with real temporary git repositories with one commit): `start` creates the worktree, branch and `worktree` field and leaves the main checkout's branch untouched; two starts in one repo do not collide; `start` from inside a linked worktree adopts it and writes to the main checkout's store; `update` from inside a worktree updates the shared record; `start` in a non-git directory and in a repo with no commits fails and leaves no Run folder; `remove` deletes a clean worktree but keeps the branch; `remove` refuses a worktree with uncommitted changes and keeps the history; `remove` of an older record with no `worktree` still works.
- **CLI** (existing spawn-based seam): `run start` and `run update` behave the same from the main checkout and from a worktree, and a start failure exits non-zero with the message.
- **Dashboard HTTP** (existing seam): started from the main checkout it lists Runs created from a worktree, and a refused delete shows an error and keeps the Run.
- **Skills test** (existing): the committed `factory` skill no longer tells the agent to start a branch at Build and mentions the Run worktree.

Prior art: the existing `run-store`, `run-cli`, `dashboard` and `skills` tests, which already use temporary project directories and spawned processes.

## Out of Scope

- Coordinating which Ticket each agent picks up, and isolating ports or other machine-level state.
- Two agents working on the same Run.
- A Factory-run dependency install step.
- Deleting branches, or force-removing a dirty worktree.
- Moving existing Run folders or migrating older records.

## Further Notes

The worktree directory is inside the main checkout but gitignored, so `git status` stays clean there. A worktree's own `.factory` is never used, because the Run store always resolves to the main checkout. The existing manual worktree at `/tmp/tds-factory-unify-stage-agent` is unaffected.
