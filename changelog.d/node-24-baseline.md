### Changed

- The Factory needs Node 22 or newer: Node 20 is no longer supported by `engines`, the installers, CI or the release workflow.
- The carried-verdict tests reuse one Run per test, which shortens the unit tests on Windows.
