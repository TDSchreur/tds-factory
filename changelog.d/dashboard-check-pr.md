### Removed

- The Dashboard no longer merges a pull request. The Merge button and its note on Done cards, the
  `POST .../merge` and `GET .../merge-checks` routes, `prMerge` and `prCanMerge` and the PR provider's `merge`
  are gone; merge on the host, where CI and review apply.

### Changed

- `tds-factory run follow-up` takes `--scope conflicts|checks|comments`, required when the PR has findings. Only
  findings of that scope send the Run back to Build as a Rework; the others stay in the `follow_up` snapshot, which
  now also records whether the PR has merge conflicts (`conflicts`) and the `scope` of the Rework it started.

### Added

- `GET /api/projects/<id>/runs/<run-id>/pr-details` reads a Done or Follow-up Run's pull request fresh (state,
  draft, conflicts, failing and pending checks, unresolved review threads) without touching the PR status cache. When
  `gh` or `az` is missing or not signed in, it answers the host's setup steps. The PR provider's unused
  `checksSummary` is replaced by `details`.
- `POST /api/projects/<id>/runs/<run-id>/follow-up?scope=...&updated=...[&grant=true]` (the Dashboard's Fix) starts a
  Follow-up scoped to one problem of a GitHub pull request, moves the Run to Build and leaves it waiting with "Follow-up
  Rework ready for an agent". With `grant=true` at the Check loop limit it raises `extra_loops` by one (with the
  `extra-loop` event) and then starts the Fix. The Run views carry `reworkInProgress`. Follow-up's `gh` reads now run
  as steps of the same flow as its git calls, so the Dashboard does not block on them.
- The factory Skill has `/factory continue <run id>` (`references/continue.md`), which resumes a Run from its current
  Stage, including a Follow-up Rework started from the Dashboard. `references/follow-up.md` documents the three scopes,
  the `run sync` step of a `conflicts` Rework and the rules of a `comments` Rework (list the comments judged to need no
  change; never reply to or resolve threads).
- The Dashboard has a **Check PR** button on a Done Run with an open pull request and on a Run in Follow-up. It reads
  the pull request fresh and opens the Run detail on a "Pull request" section: state and draft, merge conflicts,
  failing checks (each with a link to its run), pending checks and unresolved review threads. A missing or signed-out
  `gh` or `az` shows that host's setup steps. Host text is shown as plain text and only `https:` links are anchors.
