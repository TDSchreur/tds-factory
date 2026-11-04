# Update chooses destinations before upgrading the CLI

> Applies [ADR 0037](0037-install-selections-own-destination-cleanup.md) to `tds-factory update` and the Bootstrap installers.

`tds-factory update` replaces the CLI with `npm install -g` and then installs the Skills with the new code. A cancelled prompt after the npm step would leave a new CLI next to old Skills and an unchanged selection, which ADR 0037 forbids for an Update.

**Decision.** The installed CLI resolves the Install selection first, with the same flag and prompt code as `install`. It cancels, or fails without a terminal, before the download, the checksum, `npm install -g`, any installed file and the saved selection. It then starts the new CLI's `install` with the resolved choice as explicit flags (`--agent`, `--claude-dir`), so the choice is asked once. `--reuse-selection` is never implied: unattended use passes explicit flags or `--reuse-selection`.

A CLI from before this decision cannot ask first, so the first update from such a version chooses after the upgrade, through the new CLI's own prompt. The update that follows asks first.

The Bootstrap installers cannot ask first, because they run before any Factory code exists. They install the CLI and then call `tds-factory install`; a cancelled prompt leaves the CLI installed and the Skills, agents and saved selection unchanged. `install.sh` translates its arguments and `TDS_FACTORY_AGENT`, `TDS_FACTORY_CLAUDE_DIR` and `TDS_FACTORY_REUSE` into `install` flags and leaves validation to the CLI. `install.ps1` does not translate a choice yet and still relies on the CLI's console prompt.
