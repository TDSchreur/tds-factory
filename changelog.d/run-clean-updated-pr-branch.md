### Fixed

- `tds-factory run clean` cleans a merged Run whose PR head moved ahead of the local branch (for example after "Update branch" on GitHub), as long as the local tip is an ancestor of the merged PR head. If the PR head is not in the repository yet, the Run is kept and the message says to fetch it.
