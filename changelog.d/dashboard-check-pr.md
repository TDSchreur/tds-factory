### Removed

- The Dashboard no longer merges a pull request. The Merge button and its note on Done cards, the
  `POST .../merge` and `GET .../merge-checks` routes, `prMerge` and `prCanMerge` and the PR provider's `merge`
  are gone; merge on the host, where CI and review apply.
