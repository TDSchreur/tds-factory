### Changed

- Project registry ids now use 12 hex characters and collision-safe locking/writes.
- Dashboard launch always prints a `?project=<id>` link for the main checkout, even when registry writes fail.
- Dashboard UI groups missing Projects into one summary row and adds bulk cleanup for missing entries.
- Tests now isolate `TDS_FACTORY_CONFIG_DIR` by default, so direct `node --test` runs do not touch the real user config folder.

### Fixed

- Registry registration now degrades safely when checkout discovery or writes fail.
- Dashboard project removal now returns an explicit conflict for the server's own unregistered Project id, while unknown ids stay 404.
