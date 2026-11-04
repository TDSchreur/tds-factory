### Added

- `tds-factory install` asks which destinations to install into, one line per agent target and Claude folder, with saved choices preselected and nothing selected the first time. Without a terminal use `--agent claude,codex` (or `all`), `--claude-dir PATH` and `--reuse-selection`. Copilot now gets its own skills folder.
- Choices are saved per user and per project, outside the project's files. Deselected destinations are cleaned up: Factory-owned skills and agent files are removed, and edited ones are backed up first.
- Install verifies that every folder it touches is trusted (owner, permissions, links, filesystem) before it writes; a failed check changes nothing.

### Changed

- `tds-factory install` no longer defaults to all agents. `update` and the Bootstrap scripts still call it without a choice until issue #568 lands.

### Removed

- macOS is unsupported: install refuses it before any change.
