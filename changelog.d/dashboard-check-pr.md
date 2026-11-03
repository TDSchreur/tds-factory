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
