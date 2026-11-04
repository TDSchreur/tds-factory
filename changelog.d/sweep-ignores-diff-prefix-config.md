### Fixed

- `tds-factory run sweep` gives the same answer when the git config sets `diff.mnemonicprefix` or `diff.noprefix`. It
  used to miss the lists and claims sections of a diff in that case.
