### Security

- Installing on Windows starts PowerShell 7 from its fixed Program Files folder with a system working directory instead of searching PATH, and refuses when it is missing.
- Installing rechecks the identity of each verified folder immediately before every write or removal and stops when a folder was swapped.

### Fixed

- `tds-factory install` without a terminal shows the full command example, `--dry-run` refuses unsupported platforms, and typed `add:` paths are limited to 4096 characters.
- Installing rechecks the backup folder before creating or copying into it, refuses a link when recording what it created, compares the folder identities from before and after the Windows PowerShell check, rejects paths that are not valid UTF-8 and starts PowerShell with a minimal environment.
