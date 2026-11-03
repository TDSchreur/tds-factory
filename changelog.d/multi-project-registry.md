### Added

- A per-user Project registry (`projects.json` in the Factory config folder). A Project joins it when a Run starts in it and when `tds-factory dashboard` runs there.

### Changed

- `tds-factory dashboard` shares one Dashboard on port 4300 (a free port when it is busy) instead of one port per repository. A later call in another repository registers it, prints the URL with `?project=<id>` and exits; an older running Dashboard gets a warning and is never stopped. `--port N` still starts a separate Dashboard.
- `/api/info` also returns the process id of the server.
