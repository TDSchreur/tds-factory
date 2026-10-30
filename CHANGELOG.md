# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-30

### Added
- The Dashboard header shows the Factory version.
- At 1024 CSS pixels and below, the Dashboard shows one Stage at a time, with Stage buttons that carry Run counts and a "Needs you" marker.
- At those widths Run detail fills the screen with a Back control, contained keyboard focus and a locked background.

### Changed
- Dashboard controls are at least 44 pixels high on small screens, long text and links wrap, and dialogs scroll on short screens.
- `dev-install` and `install-dev-skills` are one setup script.
- CI and Release are hardened, and Release checks that the README install URL works.
- A missing Verify line is reported as missing, with the line to add.
- Browser tests set the exact CSS viewport through ChromeDriver emulation.

### Fixed
- The flaky Delete all Dashboard test no longer races the delete requests.

## [0.2.0] - 2026-10-30

### Added
- Runs can now be deleted from every Dashboard column.

### Changed
- The Copilot Define and Check agents are pinned to an available model.
- The Build Stage now carries the instruction that Prepare used to give through ponytail.

### Removed
- **Breaking:** the Prepare Stage.
- **Breaking:** the ponytail skill and its vendored copy.

[0.2.0]: https://github.com/TDSchreur/tds-factory/compare/v0.1.10...v0.2.0
