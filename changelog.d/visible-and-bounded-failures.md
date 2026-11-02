### Changed

- Failures that a caller has to tell apart now carry one marker, a `code` on a `FactoryError`, instead of a `reason`, a `permanent` flag or a pattern in the message. Messages are unchanged.

### Fixed

- `tds-factory update` no longer hangs on a server that never answers: each request is limited to 30 seconds (the download to 120 seconds), and a request that runs out of time is retried like a server error.
