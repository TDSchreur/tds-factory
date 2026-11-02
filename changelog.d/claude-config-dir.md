### Fixed

- The Claude user folder follows `CLAUDE_CONFIG_DIR` when it is set to a non-empty value, instead of always being `~/.claude`: `tds-factory install`, `scripts/dev-install.js`, `doctor`, project reviews and the Usage of Claude sessions use it.
