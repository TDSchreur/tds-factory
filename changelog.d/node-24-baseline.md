### Added

- The Dashboard has a "Skip to the Runs" link as its first Tab stop.

### Changed

- The Factory needs Node 24 or newer: `engines`, the installers, CI and the release workflow no longer support Node 20 or 22.
- The Windows unit tests run in two CI shards, and the carried-verdict tests reuse one Run per test, so the Windows job finishes sooner.
- CI lints every script under `scripts/` with shellcheck and PSScriptAnalyzer, not only the installers.
