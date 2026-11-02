### Changed

- The Factory checks out and tests on Windows: `.gitattributes` keeps text files on LF, CI runs `npm run check` and `npm run test:unit` on `windows-latest`, and the browser tests use `msedgedriver` and Edge there.

### Fixed

- On Windows, `tds-factory doctor` finds commands that are `.cmd` shims (such as `npm`) when it checks the Verify command.
- On Windows, Run worktrees are recognized when git prints their paths with forward slashes, so `run clean`, `run repair` and Doctor work.
- The Dashboard no longer shifts its layout when the compact detail opens on a system with classic scrollbars (Windows).
