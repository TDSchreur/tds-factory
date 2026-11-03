### Added

- The Dashboard server serves every Project in the Project registry, picks up Projects added later without a restart, and reports a Project whose folder is gone as missing. `DELETE /api/projects/<id>` removes a Project from the registry by its id.

### Changed

- Run routes name the Project: `/api/projects/<id>/runs/<run-id>...` and `/files/<id>/<run-id>/<name>`. `/api/views` answers `{ projects: [{ id, name, missing, runs }] }`, and every Run carries its `projectId`. `/api/runs` is now `/api/projects/<id>/runs`.
- `/api/info` also says whether the Dashboard is `shared` (backed by the registry). `tds-factory dashboard` reuses only a shared Dashboard on port 4300; a `--port` Dashboard there counts as a busy port.
- The fallback page links to `/api/views` instead of the removed `/api/runs`.
