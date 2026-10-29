# Release distribution

> Historical specification: the per-merge release policy below is superseded by [manual releases](manual-releases.md).

## Problem Statement

To give a colleague the Factory, I tell them to clone the repository and run a setup script. That needs git, the submodules, a checkout to keep around, and a manual update by pulling and running the script again. I want colleagues to install and update the Factory with one command.

## Solution

Every change merged to `master` publishes a Release on GitHub. A colleague installs or updates the Factory by running one `npm install -g` command that points at the latest Release, then runs `tds-factory install` for the skills. `tds-factory --version` shows which version they have. The repository becomes public so the command needs no login or token.

## User Stories

1. As a colleague, I want to install the Factory with one command, so that I do not need to clone anything
2. As a colleague, I want the same command to update the Factory, so that I do not learn a second one
3. As a colleague on Windows, macOS or Linux, I want the command to work the same on my system, so that the README has one install line
4. As a colleague, I want to run `tds-factory --version`, so that I know which version I have
5. As a colleague, I want the install to need no token and no `gh` login, so that I can start right away
6. As a colleague, I want the skills installed by an explicit `tds-factory install`, so that nothing writes into my agent folders without me asking
7. As the maintainer, I want a Release published for every merged change, so that colleagues get fixes without me doing anything
8. As the maintainer, I want the version chosen automatically, so that I never bump `package.json` by hand for a normal change
9. As the maintainer, I want to raise the minor or major version by editing `package.json`, so that I control breaking changes
10. As the maintainer, I want a failing test to stop the Release, so that colleagues never get a broken build
11. As the maintainer, I want the Release asset to have a fixed name, so that the latest-release URL never changes
12. As the maintainer, I want the Release workflow not to commit to `master`, so that it cannot trigger itself or clash with merges
13. As the maintainer, I want two merges in quick succession to get different versions, so that a Release never overwrites another
14. As the maintainer, I want the README to start with the one-line install, so that colleagues find it first
15. As a contributor, I want `setup.sh` and `setup.ps1` kept for working from a checkout, so that I can develop the Factory
16. As the maintainer, I want the repository and its history checked for secrets and company-specific data before it goes public, so that I do not publish something I cannot take back
17. As the maintainer, I want to switch the repository to public myself after reading that check, so that the one-way step stays my decision

## Implementation Decisions

- A GitHub Actions workflow runs on every push to `master`. It installs nothing beyond Node, runs the tests, picks the version, packs the Factory, and publishes a GitHub Release with the tarball as its only asset.
- The version has the major and minor from `package.json`. The patch is the next number after the highest existing tag with the same major and minor, starting at 0. The chosen version is written into the packed `package.json` only. The workflow makes no commit.
- The tag is `v<version>`. The workflow serializes runs so two merges cannot choose the same version.
- The tarball is named `tds-factory.tgz` without a version. The Release is marked latest, so `releases/latest/download/tds-factory.tgz` is the stable install URL.
- The tarball holds what `npm pack` already ships: the CLI, the sources, the committed skill copies and the Dashboard. It does not need the `vendor/` submodules, as ADR 0001 describes.
- The CLI gains `--version`, which prints the version from its own `package.json`, and the usage text mentions it.
- The version-choosing logic is a small separate script with tests, so it can be checked without GitHub.
- The README opens its Setup section with the install and update command, and then `tds-factory install`. The setup scripts stay and are described as the route for working from a checkout.
- A one-off check of the working tree and the full git history looks for secrets and company-specific data. The result is a written report. The repository's visibility is changed by the maintainer, never by an agent.
- No `postinstall` hook, no update check in the CLI, no GitHub Packages.
- ADR 0005 and the glossary term Release record the decision.

## Testing Decisions

- A good test checks behavior visible to a colleague or to the workflow, not how the script is written inside.
- The CLI seam: the existing CLI tests run `bin/tds-factory.js` as a process. A new test runs it with `--version` and expects the version of `package.json` on one line and exit code 0.
- The version script seam: a unit test feeds it a `package.json` version and a list of existing tags and checks the result: first Release of a minor line, next patch, tags of other minor lines ignored, tags that are not versions ignored, a raised minor starting again at patch 0.
- The workflow file itself cannot run in `npm test`. A test reads it and checks the points that break installs if changed: it triggers on pushes to `master`, runs the tests before publishing, and publishes an asset named `tds-factory.tgz`.
- Prior art: `test/run-cli.test.js` for the CLI, `test/sync.test.js` for small script tests.

## Out of Scope

- Making the repository public (done by the maintainer).
- Publishing to npm or GitHub Packages.
- An update check or notification inside the CLI.
- Installing skills automatically on `npm install`.
- Signing, checksums or provenance of the tarball.
- Release notes beyond what GitHub generates.
- Changing which skills ship or how `sync` works.

## Further Notes

- Every merged change produces a Release, including docs-only ones. That is accepted.
- The first Release after merging is `v0.1.0` if no tag exists, because the version script starts at patch 0.
