### Changed

- Failures that a caller has to tell apart now carry one marker, a `code` on a `FactoryError`, instead of a `reason`, a `permanent` flag or a pattern in the message. Messages are unchanged.

### Fixed

- `tds-factory update` no longer hangs on a server that never answers: each request is limited to 30 seconds (the download to 120 seconds), and a request that runs out of time is retried like a server error.
- `tds-factory install` stops with a message that names the file when the agent install record cannot be parsed, instead of treating it as missing.
- The Dashboard writes the cause of an unexpected error, and of a failed GitHub PR lookup, merge or checks call, to stderr instead of dropping it. Reading a Run file, a Run folder or a session log now fails on a permission error instead of reporting it as absent.
