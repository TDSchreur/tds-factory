### Changed

- `tds-factory run split` and the Dashboard split answer clean a printed link the same way: control characters, format
  characters (bidi, zero-width, ZWJ) and the line and paragraph separators become a space. `run split` used to print a
  `?` for them.
