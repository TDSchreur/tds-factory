### Security

- Installing on Windows starts PowerShell 7 from its fixed Program Files folder with a system working directory instead of searching PATH, and refuses when it is missing.
- Installing rechecks the identity of each verified folder immediately before every write or removal and stops when a folder was swapped.

### Fixed

- `tds-factory install` without a terminal shows the full command example, `--dry-run` refuses unsupported platforms, and typed `add:` paths are limited to 4096 characters.
