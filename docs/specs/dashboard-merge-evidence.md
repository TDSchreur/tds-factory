# Dashboard merge honours Run Evidence

## Problem Statement

The Dashboard can squash-merge a Done Run's open PR without checking whether its Evidence still describes the code being merged. A PR URL can also point at another repository, and its branch can move between confirmation and merge.

## Solution

Keep the existing user-triggered merge and confirmation dialog. Require the same current-head clean or Accepted Check eligibility as moving a Run to Finish, verify the PR belongs to the Run's repository and has the eligible head, then squash-merge only that commit. Show unavailable, failing and pending GitHub checks explicitly in the existing confirmation.

## User Stories

1. As a developer, I want merge to require current Run Evidence, so that stale reviews cannot authorize changed code.
2. As a developer, I want an Accepted Check for the current head to retain its existing meaning, so that my recorded decision also applies at merge.
3. As a developer, I want a dirty or unavailable Run worktree to prevent merge, so that eligibility cannot be guessed.
4. As a developer, I want the PR to belong to the Run's repository, so that a mistaken PR link cannot merge unrelated work.
5. As a developer, I want the PR's current head to match the eligible Run head, so that only reviewed code can merge.
6. As a developer, I want a head change during the merge request to fail, so that a race cannot bypass Evidence.
7. As a developer, I want unavailable, failing or pending GitHub checks named in the confirmation, so that I can make an informed merge decision.
8. As a developer, I want merge to remain my explicit action, so that the Dashboard adds neither auto-merge nor another approval stage.

## Implementation Decisions

- Reuse the Run store's Finish eligibility logic, including current head, clean worktree, Verify result, Check attempt and Accepted Check rules. Do not copy a second policy into the Dashboard.
- Resolve the expected GitHub repository from the Run worktree's origin and reject unresolved origins or a PR URL for another repository before merging.
- Read the PR's current state and head from GitHub freshly for merge. Require an open PR and equality with the eligible Run head.
- Pass the eligible head to `gh pr merge --squash --match-head-commit` to protect against changes after the read.
- Provide check information to the existing confirmation dialog. GitHub check warnings are explicit information; Run Evidence, repository and head checks remain hard requirements.
- Revalidate hard requirements when the user confirms. Retain same-origin protections, error reporting and PR-state cache invalidation.
- Older Runs remain readable, but absent Evidence or a missing worktree cannot authorize merge.

## Testing Decisions

- Exercise the Dashboard HTTP API with real temporary git repositories and a fake `gh` executable, extending the existing PR-state tests.
- Assert successful clean and Accepted Check merges use the expected URL and head-lock argument.
- Assert missing, failed or stale Evidence, dirty worktrees, repository mismatch, PR head mismatch and unavailable GitHub data never invoke merge.
- Exercise a changing PR head through fake `gh` and verify a failed protected merge is reported.
- Cover explicit check reporting for unavailable, failing and pending checks in confirmation data and the existing UI flow.
- Run the repository's `npm test` Verify command.

## Out of Scope

- Auto-merge, new approval stages, branch deletion and additional merge strategies.
- Changing the meaning of clean or Accepted Check, rewriting historical Run records, or adding another Evidence schema.

## Further Notes

This completes the Dashboard merge follow-up excluded from the Run flow enforcement Spec. Existing glossary terms and ADR 0006 already describe the domain and the shared Run store ownership; no new term or architecture decision is needed.
