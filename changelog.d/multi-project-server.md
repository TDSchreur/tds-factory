### Added

- The Dashboard server serves every Project in the Project registry, picks up Projects added later without a restart, and reports a Project whose folder is gone as missing. `DELETE /api/projects/<id>` removes a Project from the registry by its id.

### Changed

- Run routes name the Project: `/api/projects/<id>/runs/<run-id>...` and `/files/<id>/<run-id>/<name>`. `/api/views` answers `{ projects: [{ id, name, missing, runs }] }`, and every Run carries its `projectId`. `/api/runs` is now `/api/projects/<id>/runs`.
