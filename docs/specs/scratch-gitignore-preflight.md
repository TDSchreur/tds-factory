# Preflight keeps `.scratch/` out of git for a local tracker

No GitHub issue; the user asked for it in Run 2026-11-03-preflight-keep-scratch-out-of-git-when-the-issue-tracker-is-local (Full track, chosen by the coordinator). See [ADR 0032](../adr/0032-preflight-keeps-scratch-out-of-git-for-a-local-tracker.md).

## Problem Statement

A project whose Issue tracker is local Markdown keeps its Spec and Tickets under `.scratch/`. Nothing tells the user to keep that folder out of git, so tracker files end up in commits and pull requests. The Factory Skill only tells the user to ignore `.factory/`, and the Doctor does not look at the tracker kind or at ignore rules.

## Solution

The Doctor gains a read-only `scratch-ignore` check. For a project with a local tracker it reports whether `.scratch/` is already ignored by git. When it is not, the Factory Skill's Preflight fixes it before the Run starts and tells the user exactly what it changed: it appends `.scratch/` to the main checkout's `.gitignore` (left uncommitted, and the user is asked to commit it) and adds the same line to the repository's `.git/info/exclude`, so the ignore applies at once in every Run worktree. A project with a remote tracker is not touched. The check never stops a Run.

## User Stories

1. As a user with a local tracker, I want Preflight to notice that `.scratch/` is not ignored, so that tracker files do not end up in commits.
2. As a user with a local tracker, I want Preflight to add `.scratch/` to my `.gitignore`, so that I do not have to remember it.
3. As a user, I want to be told exactly which files Preflight changed, so that nothing is edited silently.
4. As a user, I want to be told to commit the `.gitignore` line, so that teammates and the default branch get the same rule.
5. As a user, I want the ignore to apply at once in the Run worktree, so that Tickets written there are not staged before I commit the `.gitignore` line.
6. As a user with GitHub Issues or another remote tracker, I want Preflight to leave `.gitignore` and `.git/info/exclude` alone, so that nothing changes for me.
7. As a user whose `.scratch/` is already ignored by any rule (`.scratch`, `/.scratch/`, a global excludes file), I want no change and no message, so that Preflight stays quiet.
8. As a user, I want a failing or missing `scratch-ignore` check never to stop my Run, so that Preflight stays usable.
9. As a user running `tds-factory doctor` myself, I want it to stay read-only and report the missing ignore, so that I see the state without side effects.
10. As an agent running the Factory Skill, I want one rule that says which ignore I edit and which I only report, so that I do not edit `.gitignore` for `.factory/`.
11. As a user on Windows, I want the check to work without a shell, so that it behaves the same everywhere.
12. As a user at Finish, I want the PR body to say Tickets are "local, not committed" instead of linking paths that do not exist in the PR, so that reviewers are not sent to dead links.
13. As a user in Define, I want the Define artifacts commit to leave `.scratch/` out, so that local Tickets are not force-added.
14. As a maintainer, I want the docs, the glossary and an ADR to describe the rule, so that the `.factory/` and `.scratch/` rules are not read as a contradiction.

## Implementation Decisions

- The Doctor adds a shared check `scratch-ignore`. It reads the project's tracker file and treats the tracker as local when the file names local Markdown or `.scratch/`, or names no tracker (the same default the Factory Skill gives `to-tickets`). A file that names GitHub, Azure DevOps, Jira, Linear or another remote tracker is not local. When the tracker file is missing the check passes and the existing `tracker` check reports the problem.
- Coverage is decided by asking git whether a probe path inside `.scratch/` is ignored (`git check-ignore -q`), through the Doctor's existing git helper, with no shell. This honours any ignore pattern, `.git/info/exclude` and a global excludes file, in the main checkout.
- Status values: `pass` when the tracker is remote or the path is ignored; `missing` with a message that names the fix when it is not. `scratch-ignore` is exempt from the report's `ok`, like `verify-fast`: it is shown, never makes `ok` false, and the Skill never stops on it.
- The Doctor stays read-only. The Factory Skill performs the fix in Preflight, in the main checkout, before `run start`: it appends `.scratch/` to `.gitignore` (creating it if absent), adds the line to `.git/info/exclude` of the shared git directory, and reports both changes to the user, including that the `.gitignore` edit is uncommitted and should be committed to the default branch.
- The Skill's Gitignore rule becomes: `.factory/` is only reported to the user; `.scratch/` for a local tracker is the one case the Skill edits.
- Define commits its artifacts without `.scratch/`. Finish's PR body names local Tickets as "local, not committed" and does not list their paths; `tickets` in the Run record keeps its repo-relative paths. Nothing in the Run commands needs the Ticket files committed.
- Skills vendored from `vendor/` are not edited; only the Factory Skill and its references change, then `tds-factory install` refreshes the committed copies.
- Docs: README, usage and install guides, the Doctor's help text and the glossary (Doctor entry, new Local tracker term) are updated; a changelog fragment is added; ADR 0032 records the decision.

## Testing Decisions

- A good test drives the `tds-factory doctor --json` command against real temporary git repositories and checks only the reported check and `ok`, not internals.
- Cases: local tracker with and without an ignore (`.scratch`, `/.scratch/`, `.scratch/`, a global excludes file, `.git/info/exclude`), a remote tracker, a missing tracker file, and `ok` staying true when only `scratch-ignore` is `missing`.
- Prior art: test/doctor.test.js. The Skill text is covered by the existing skills and sync tests (test/skills.test.js, test/sync.test.js); the Skill change is checked there and by a manual Preflight in a project with a local tracker.

## Out of Scope

- Moving local Tickets elsewhere, or committing them to the Run branch.
- Ignoring `.factory/` automatically.
- A new `tds-factory` command that writes ignore rules.
- Changing the vendored tracker or `to-tickets` Skills.
- Trackers other than the local Markdown one.

## Further Notes

- An uncommitted `.gitignore` edit does not reach Run worktrees, which are created from the default branch; `.git/info/exclude` is shared by all worktrees, which is why both are written.
- `run clean` removes a Run worktree, and with it any ignored Ticket files written there; this is accepted by the user.
