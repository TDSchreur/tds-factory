# Node 24 baseline, faster Windows unit tests and an instruction audit

## Problem

Node 20 is out of support, yet `engines`, the Bootstrap installers and CI still allow it. The Windows job "Check and unit tests on Windows" takes about 6 minutes, four times the Linux unit job, so it gates every PR. The repo also carries instruction guides (`.github/instructions/`) that nobody has compared with the code.

## Decisions

- Only active LTS lines are supported: Node 24 and newer. Node 22 is dropped with Node 20.
- Windows speed is attacked in the tests and in CI: the slowest tests reuse one Run, and the Windows unit tests run in two shards.
- The audit covers the workflows, the shell and PowerShell scripts, the Markdown documents and the Dashboard; findings are fixed in this Run.

## Stories

1. As a maintainer, I want `engines`, `install.sh`, `install.ps1`, CI and the release workflow to require Node 24, so that we test and support only active LTS lines.
2. As a user on Node 22 or older, I want the installers to say I need Node 24 or newer, so that I know what to upgrade.
3. As a contributor, I want the Windows unit job to finish in about half the time, so that PRs are not held up by it.
4. As a maintainer, I want every shell script under `scripts/` linted with shellcheck and every PowerShell script under `scripts/` with PSScriptAnalyzer in CI, so that `use-repo` and `use-official` are held to the same guides as the installers.
5. As a reader, I want code fences to name their language and links to be descriptive, so that the docs follow the Markdown guides.
6. As a keyboard or screen reader user, I want a skip link on the Dashboard, so that I can jump past the header.

## Decisions on design

- Node 24 minimum: `engines` is `>=24`; the CI matrix is Node 24 and `lts/*`; the release matrix is the same; the `parentPath ?? path` fallbacks for Node before 20.12 go away. ADR 0022 and `docs/specs/scoped-conventions.md` keep their own matcher (an untrusted glob needs a bounded matcher whatever `path.matchesGlob` does); their Node 20 remark is history and stays.
- Windows: the carried-verdict tests start one Run per test and reset its branch between cases; the `windows` CI job becomes a matrix of two shards (`--test-shard=1/2`, `2/2`) through `scripts/test-unit.js`; shard 1 also runs `npm run check`, and `ci-ok` still needs the `windows` job.
- The Dashboard skip link is the first focusable element and links to the board; it is hidden until focused.

## Testing

- `test/install-sh.test.js` and `test/install-ps1.test.js`: Node 22 is refused, 24 passes.
- `test/ci.test.js`: the workflows' matrices and the shard jobs.
- `test/dashboard-a11y-browser.test.js`: the skip link is first in tab order and moves focus to the board.
- `npm test`, `npm run check`, `shellcheck` on every `scripts/*.sh`, PSScriptAnalyzer on every `scripts/*.ps1`, `actionlint`.

## Documents

`README.md`, `docs/install.md`, `docs/development.md`, `docs/releasing.md`, `AGENTS.md` (Commands: shellcheck and PSScriptAnalyzer scope), `docs/dashboard.md` (skip link), `changelog.d/node-24-baseline.md`.

## Out of scope

Changelog fragments keep their `###` headings (the changelog tool requires them). ADRs and archived specs are history.
