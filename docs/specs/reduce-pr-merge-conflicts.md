## Problem Statement

Pull requests often show merge conflicts by the time they are opened. `run start` branches from a freshly fetched `origin` default branch, but a Run takes hours, several Runs run side by side, and nothing brings the Run branch up to date afterwards. Nearly every Run also edits the same lines under `## [Unreleased]` in `CHANGELOG.md`, so two overlapping Runs conflict there almost every time.

## Solution

Two changes. First, `tds-factory run sync` rebases the Run branch onto the current `origin` default branch, and moving a Run to Finish is refused while the branch would not merge cleanly into that branch, so conflicts surface during the Run and not in the PR. Second, changelog entries move out of the shared `[Unreleased]` lines into one fragment file per change, folded into `CHANGELOG.md` by a maintainer script at release time.

## User Stories

1. As a Factory user, I want `run sync` to fetch and rebase my Run branch onto origin's default branch, so that I resolve conflicts while I still have the context.
2. As a Factory user, I want `run sync` to leave my branch untouched and name the conflicting files when the rebase conflicts, so that I can decide how to resolve them.
3. As a Factory user, I want Finish to refuse when the branch would conflict with origin's default branch, and to say to run `run sync`, so that I never open a PR that cannot merge.
4. As a Factory user, I want Finish not to refuse just because the base moved, so that an unrelated merge does not force a new Check.
5. As the Factory, I want `run sync` to clear the Evidence when it moves the head, so that Check cannot pass on code that was not reviewed.
6. As a contributor, I want to add a fragment file `changelog.d/<name>.md` instead of editing `CHANGELOG.md`, so that two PRs never edit the same lines.
7. As a maintainer, I want `node scripts/changelog.js release <version>` to fold the fragments and the current `[Unreleased]` entries into a dated version section and delete the fragments, so that releasing the changelog is one small PR.
8. As a maintainer, I want `npm test` to reject a malformed fragment, so that a bad fragment cannot break the release step.

## Implementation Decisions

- `run sync --id ID [--data JSON]` works on a running Run in Build or Check. It refuses a worktree with uncommitted changes. It fetches origin's default branch the way `run start` does, rebases the Run branch onto it, and sets `base_sha` to the fetched commit. When the rebase conflicts, it aborts the rebase, leaves the branch as it was, and reports the conflicting files in the error. When the head moves it removes the verdicts, the Verify result, `reviewed` and `accepted`, as `run rework` does, without counting a loop. When nothing moves it changes nothing but `base_sha` and `activity`.
- `run transition --to finish` fetches origin's default branch and refuses with a message that names `run sync` when `git merge-tree --write-tree` reports that the branch would not merge cleanly. A moved base without a conflict does not refuse. This gate is part of "Finish needs a clean or Accepted Check" and does not apply to an Accepted Check's findings.
- The `factory` Skill tells the agent to run `run sync` before moving to Check, and again when Finish refuses.
- Fragments live in `changelog.d/`. A fragment is a Markdown file with one or more `### Added|Changed|Deprecated|Removed|Fixed|Security` headings, each followed by `- ` lines. `changelog.d/README.md` explains the format and is never folded.
- `scripts/changelog.js` exports `parseFragment` and `release`. `release <version> [date]` collects entries from the fragments and from the body of `## [Unreleased]`, groups them by heading in Keep a Changelog order, writes `## [version] - date` below an emptied `## [Unreleased]`, and deletes the fragments. It refuses a malformed fragment and a version that already has a section.
- `CONTRIBUTING.md`, the PR template, `AGENTS.md` and `docs/releasing.md` describe fragments and the release step. `GLOSSARY.md` gets **Run sync** and **Changelog fragment**.

## Testing Decisions

- Seam 1, `run sync` and the Finish gate through the store and CLI, using the existing git fixtures in `test/run-worktrees.test.js` and `test/git-repo.js`: a Run behind a base that changed other files syncs and clears Evidence; a conflicting base reports the files and leaves the head alone; Finish refuses a conflicting branch and passes a branch behind a non-conflicting base.
- Seam 2, `scripts/changelog.js` as a module on a temp directory: grouping and order, merging the `[Unreleased]` body, deleting fragments, refusing malformed fragments and an existing version.
- A repo test runs `parseFragment` on every file in `changelog.d/` so a bad fragment fails `npm test`.
