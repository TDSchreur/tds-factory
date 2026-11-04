# Disable the Windows jobs in CI

## Spec

The Windows CI jobs are switched off: the `windows` job (checks and unit tests in two shards), the `install-windows` job (`install.ps1` on PowerShell 7) and the `windows-latest` entry of the `package` matrix are removed from `.github/workflows/ci.yml`, and both jobs leave the `needs` list of `ci-ok`, so the aggregate check still passes on the remaining jobs. `test/ci.test.js` stops asserting the Windows jobs; its PSScriptAnalyzer assertions stay, and a new assertion says no CI job runs on Windows. `docs/development.md` (the CI paragraph) no longer says CI runs on Windows, and the "Working on Windows" section says the tests are not run in CI there. A changelog fragment records the change. The Windows code, tests and guides stay; only the CI runs go. No ADR and no glossary change.

## Documents

`docs/development.md` (CI paragraph, "Working on Windows"), the `reliable-tests` guide (`.github/instructions/` and its `.claude/rules/` copy), `skills/reliable-tests/SKILL.md`, `changelog.d/disable-windows-ci.md`. `docs/specs/windows-friendly.md` and the other finished Specs stay as they are.
