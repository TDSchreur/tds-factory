### Added

- `tds-factory doctor` reports a `scratch-ignore` check: for a project with a Local tracker it says whether git ignores `.scratch/`. It never makes the report fail, and the factory Skill's Preflight adds `.scratch/` to `.gitignore` and `.git/info/exclude` when it is missing.
