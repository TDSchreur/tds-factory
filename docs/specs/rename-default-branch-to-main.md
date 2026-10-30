## Problem Statement

The repository's default branch is `master`. The maintainer wants it to be `main`. The workflows, the release test, the docs and the install scripts name `master`, so they break or mislead once the branch is renamed.

## Solution

Rename the default branch on GitHub to `main` and update every live reference. Historical records stay as written: archived specs, the body of ADR 0005, released CHANGELOG entries and the flaky-test spec describe what happened under the old name.

## User Stories

1. As a maintainer, I want CI to run on pushes to `main`, so that the suite keeps guarding the default branch.
2. As a maintainer, I want the manual release workflow to run only on `main`, so that releases still come from the default branch.
3. As a contributor, I want CONTRIBUTING and the development docs to say `main`, so that I branch from the right place.
4. As a user, I want the link printed by the installers to point at `main`, so that it does not rely on a redirect.
5. As a maintainer, I want the release test to assert `main`, so that the guard matches the workflow.

## Implementation Decisions

- Edit live files only: `.github/workflows/ci.yml` and `release.yml`, `CONTRIBUTING.md`, `docs/development.md`, `docs/releasing.md`, `docs/usage.md`, `scripts/install.sh`, `scripts/install.ps1`, `test/release-version.test.js`, the superseded note at the top of ADR 0005, and an Unreleased entry in `CHANGELOG.md`.
- Existing Unreleased CHANGELOG lines that name `master` are reworded to `main`, since they were never released.
- After the PR merges, rename the branch with `gh api -X POST repos/TDSchreur/tds-factory/branches/master/rename -f new_name=main`, then fix the rulesets and the `release` environment branch policy, which name `master`. GitHub redirects the old name for web links and retargets open PRs.

## Testing Decisions

- `npm test` runs the release workflow test, which asserts the `if: github.ref == 'refs/heads/main'` guard. Change the assertion first and watch it fail.
- Final check: `git grep -w master` shows only the historical files listed above.
