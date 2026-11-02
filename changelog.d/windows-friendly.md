### Added

- `scripts/use-official.ps1` and `scripts/use-repo.ps1` switch between the Release and a checkout on Windows, like the `.sh` scripts.

### Changed

- The Factory checks out and tests on Windows: `.gitattributes` keeps text files on LF, CI runs `npm run check` and `npm run test:unit` on `windows-latest`, and the browser tests skip there.

### Fixed

- On Windows, `tds-factory doctor` finds commands that are `.cmd` shims (such as `npm`) when it checks the Verify command.
- On Windows, Run worktrees are recognized when git prints their paths with forward slashes, so `run clean` and `run repair` and Doctor work.
