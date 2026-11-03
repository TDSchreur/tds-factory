### Added

- The Dashboard server answers `POST .../runs/<run-id>/continue?updated=<time>` for a Run in Build that waits for the Run size answer: the Run goes back to running with the size accepted, as `run size --accept` does. A Run in another state, a missing or stale `updated` is refused with HTTP 409.
- The Dashboard server answers `POST .../runs/<run-id>/split?updated=<time>` for the same wait: the done Tickets stay, the others leave the Run, and the answer lists the moved links. The Run waits with "Split done: ready for an agent" and not on the user, and `/factory continue` tells the agent to take it to Check and start a new Run with the links. The command line `run split` is unchanged.
