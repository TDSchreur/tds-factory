### Added

- `tds-factory update` takes the `install` flags (`--agent`, repeatable `--claude-dir`, `--reuse-selection`) and asks where to install before it downloads anything. Cancelling, no terminal without a choice and invalid flags end before any request and change nothing. The new CLI gets the choice as explicit flags, so it never asks twice. The first update from a version before this change still chooses after the upgrade.
- `install.sh` forwards its arguments (`sh -s -- --agent claude`) and reads `TDS_FACTORY_AGENT`, `TDS_FACTORY_CLAUDE_DIR` (`:`-separated) and `TDS_FACTORY_REUSE=1`. The question is asked on the terminal, never on the script's standard input. `install.ps1` is unchanged: it still runs `tds-factory install` without a choice, which asks on the console and fails without one.
- `scripts/dev-install.js` accepts `--agent`, `--claude-dir` and `--reuse-selection` and passes them to `tds-factory install`.
