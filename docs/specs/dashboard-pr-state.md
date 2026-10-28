# Show the PR state on Done cards and merge from them

## Problem Statement

A Done card links to the pull request, but not whether the PR is open or closed. I have to open the link to find out, and merge it somewhere else.

## Solution

An expanded Done card shows the PR state next to the link: Open, Merged or Closed. The Dashboard server asks GitHub through the `gh` CLI and adds the state to the interpreted Run.

An expanded Done card with an open PR also has a Merge button that squash-merges it.

## User Stories

1. As a developer, I want to see whether a Done Run's PR is open, merged or closed, so that I know if it still needs attention.
2. As a developer, I want the state to follow the real PR, so that merging it later updates the card.
3. As a developer, I want the card to look as before when the state cannot be found, so that a missing `gh`, no network or a non-GitHub PR breaks nothing.
4. As a developer, I want a Merge button on a Done card whose PR is open, so that I can finish the Run from the Dashboard.
5. As a developer, I want the merge to be a squash merge, so that the PR lands as one commit.
6. As a developer, I want to confirm before merging, so that a misclick does not merge.
7. As a developer, I want no Merge button on merged, closed or unknown PRs, so that I cannot merge what I should not.

## Implementation Decisions

- The state is looked up live, not stored in the Run record. The Run record schema does not change.
- Only Done cards with a `https://github.com/<owner>/<repo>/pull/<n>` PR link are looked up; any other value is never passed to `gh`.
- The server runs `gh pr view <url> --json state` and exposes `prState` (`open`, `merged`, `closed` or empty) in the interpreted Run from `/api/views`.
- Results are cached per URL for 60 seconds, so the 2-second poll does not call `gh` each time. A failed lookup yields an empty state.
- The card shows the state as a short label after the "Pull request" link.
- `POST /api/runs/<id>/merge` runs `gh pr merge <url> --squash`. It has the same loopback Host and same-origin checks as Delete. It merges only a Done Run whose PR is a GitHub pull request URL and whose state, looked up fresh, is open; otherwise 409. A failed `gh` gives 502. The cached state for that URL is dropped after a merge.
- The merge command is injectable (`startDashboard({ prMerge })`) so tests never run `gh`.
- The Merge button shows only for state `open`, asks for confirmation, and the board refreshes after it.
- The canonical Dashboard Spec is updated.

## Testing Decisions

- Test what a user sees: the label on an expanded Done card, and `/api/views` output with a fake lookup.
- The lookup is injectable (`startDashboard({ prState })`) so tests never run `gh`.
- Cover: each state shown; empty state shows no label; non-GitHub link is never looked up; lookups are cached.

## Out of Scope

- Other merge types, auto-merge, deleting the branch, or closing the PR.
- Storing the state in the Run record, polling GitHub faster, or other trackers than GitHub.
