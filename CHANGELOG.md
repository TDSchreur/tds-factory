# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-10-31

### Added
- The Dashboard has new actions: buttons for `run sync`, `run clean` and accepting a Check that is not clean, and a "Needs you" browser notification when a Run starts waiting on you. Starting a Run stays in the agent.
- A Fast track for bug fixes and tiny changes: one confirmation in Define, a one-paragraph Spec and a single Ticket, with Standards and Security still required in Check. The user chooses it, or confirms Define's recommendation, with `tds-factory run track`. The track is recorded in `run.json`, shown on the Dashboard and used to split `run stats` by track.
- `tds-factory run follow-up` collects PR CI failures and unresolved review threads into scoped Rework under the shared Check loop limit.
- An optional committed `.factory/config.json` sets the model per Stage, a Check loop cap (never above 4), the Ticket label and extra Project reviews, without editing agent files or running `install --force`. `tds-factory doctor` validates it and names the line to fix, a Run freezes it, and `tds-factory run config` prints it. `.factory/reviews.json` keeps working.
- Run metrics record Stage visits and Check verdict history, with `tds-factory run stats` and a Dashboard Run detail summary.

### Changed
- The Run store is split into smaller modules behind the same interface, with no change to the CLI, `run.json` or the Dashboard API.
- `docs/evaluation.md` records the first live baseline on Claude (Haiku 5.5, all seven scenarios pass), and `docs/capabilities.md` marks the Claude cells that the run proved.

### Fixed
- The Factory Skill and the install guide now say how to check for a needed label: `gh label list --search <name> --json name`, matching the exact name. The agent asks the user only when the label is absent and treats "already exists" from `gh label create` as present, so it no longer asks for a label the repository already has.
- `tds-factory doctor --agent copilot` (and `/factory` in Copilot) now finds Skills in the Claude and Codex folders, where the default `install` puts them, instead of reporting them missing.
- The offline `gh` in the evaluation answers `repo view` and `label list` for its fixture repository, and the `approval-resolved` grader no longer requires the Spec to be committed.

### Security
- Every Dashboard write route (`DELETE` and `POST`) now needs the page's own Origin and a per-session token, and the server sends no CORS headers. See ADR 0017.

## [0.4.0] - 2026-10-30

### Added
- Build ends with an Exit checklist, after the last Ticket and after every Rework: a term sweep, the required artifacts, a story trace, a security check and a self-check of its own diff. It records no verdict or Evidence; Check still owns the review.
- `npm test` checks that relative Markdown links resolve, ADR numbers are unique, a change to `src/`, `skills/` or `agents/` has a changelog fragment, the docs use no glossary Avoid term and state the Check loop limit as the code does, and browser tests are named so CI runs them.
- Projects can add source or interactive Check reviews through Skills, with configuration and Skill contents frozen per Run.
- The `add-project-review` Skill and guide help projects configure, author, and troubleshoot their reviews.
- `tds-factory run sync` rebases the Run branch onto origin's default branch, and Finish refuses a branch that would not merge cleanly into it.
- Changelog entries go in `changelog.d/` fragments, folded into `CHANGELOG.md` at release time by `node scripts/changelog.js release <version>`.

### Changed
- The default branch is now `main` instead of `master`; workflows, docs and installer links follow.
- Rework sweeps the docs again, reads its own diff and fixes cheap LOW findings in the area instead of leaving them.
- The Dashboard theme and page tests are renamed to `*-browser.test.js` so the CI browser job runs them.
- `install.ps1` supports PowerShell 7 only. The Windows one-line install is now `pwsh -c "irm https://github.com/TDSchreur/tds-factory/releases/latest/download/install.ps1 | iex"`; install PowerShell 7 first. See ADR 0011.

### Security
- The Release version calculation and a Dashboard browser test no longer build a RegExp or a script from input, which closes the two Code Scanning alerts.

## [0.3.2] - 2026-10-30

### Added
- A `ci-ok` job that succeeds only when every other CI job does, for the `master` ruleset to require.
- `SECURITY.md`, `CONTRIBUTING.md`, issue templates and a PR template.
- The release job runs in a `release` environment that only `master` can deploy to.
- `scripts/use-official.sh` and `scripts/use-repo.sh` switch between the latest Release and this checkout, and remove the other version first.

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
