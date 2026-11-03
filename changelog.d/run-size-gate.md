### Added

- Build waits on the user when finishing a Ticket leaves the Run over the size limit (about 40 KB of diff or 15 files)
  with Tickets remaining. `tds-factory run split --id ID` moves the remaining Tickets out of the Run and prints their
  links; `tds-factory run size --id ID --accept` accepts the size, and `run size` alone prints it. The Event log records
  `split` and `size-accepted`, `run update` refuses the new `size_accepted` field, and the transition to Check prints no
  size warning after an accept.

### Changed

- The Run size leaves out lockfiles and files under `test/fixtures/`, which no reviewer reads.
