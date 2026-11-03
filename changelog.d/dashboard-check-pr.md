### Removed

- The Dashboard no longer merges a pull request. The Merge button and its note on Done cards, the
  `POST .../merge` and `GET .../merge-checks` routes, `prMerge` and `prCanMerge` and the PR provider's `merge`
  are gone; merge on the host, where CI and review apply.

### Changed

- `tds-factory run follow-up` takes `--scope conflicts|checks|comments`, required when the PR has findings. Only
  findings of that scope send the Run back to Build as a Rework; the others stay in the `follow_up` snapshot, which
  now also records whether the PR has merge conflicts (`conflicts`) and the `scope` of the Rework it started.
