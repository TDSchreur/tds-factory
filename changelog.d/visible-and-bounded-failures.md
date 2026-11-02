### Changed

- Failures that a caller has to tell apart now carry one marker, a `code` on a `FactoryError`, instead of a `reason`, a `permanent` flag or a pattern in the message. Messages are unchanged.
