### Added

- `"usage": false` in `.factory/config.json` stops the Factory reading the agent session logs for token usage. It is on by default, frozen into each Run at start, and a value that is not `true` or `false` fails `doctor` with its line.
