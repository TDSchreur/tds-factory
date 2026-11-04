### Changed

- `tds-factory run transition --to check` warns that the Run size is unknown (git timed out or its output was too large)
  and counted as over the limit, unless the size was accepted. The progress commands reference and the size gate Spec
  now describe this warning.
