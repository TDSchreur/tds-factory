### Added

- The Dashboard server answers `POST .../runs/<run-id>/continue?updated=<time>` for a Run in Build that waits for the Run size answer: the Run goes back to running with the size accepted, as `run size --accept` does. A Run in another state, a missing or stale `updated` is refused with HTTP 409.
