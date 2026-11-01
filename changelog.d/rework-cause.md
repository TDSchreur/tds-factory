### Added

- `tds-factory run rework --cause <cause>` records why Check sent a Run back to Build (`stale-doc`, `test-gap`, `spec-gap`, `security`, `bug`, `size` or `other`; repeatable). `run stats --id`, `run stats --all` and the Dashboard Run detail count the causes; a Rework without a cause, and older records, count as unknown.
