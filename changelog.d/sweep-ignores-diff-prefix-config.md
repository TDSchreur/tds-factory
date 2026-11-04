### Fixed

- `tds-factory run sweep` and `run size` give the same answer when the git config sets `diff.mnemonicprefix` or
  `diff.noprefix`. The sweep used to miss the lists and claims sections of a diff in that case, and the size could
  differ by a few bytes.
