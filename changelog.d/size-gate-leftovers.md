### Changed

- `tds-factory run split` and the Dashboard split answer clean a printed link the same way: control characters, format
  characters (bidi, zero-width, ZWJ) and the line and paragraph separators become a space. `run split` used to print a
  `?` for them.
- A git call of the Run size that takes longer than 60 seconds counts as over the limit, like an output that is too
  large, so a Run cannot pass the size gate on a timeout. `tds-factory run size` says that the size is unknown and
  counted as over the limit instead of printing sentinel numbers.

### Fixed

- `tds-factory run split` and `run size --accept` write a `note:` line on stderr when the `split` or `size-accepted`
  event cannot be written to the Event log; the command still succeeds.
