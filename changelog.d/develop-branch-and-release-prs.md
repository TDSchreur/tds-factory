### Changed

- PRs to the Factory repository now go to `develop`, which is the default branch. A release PR from `develop` to `main` raises the version in `package.json`, and merging it publishes the Release; the release workflow no longer picks the patch number and refuses a version that already has a tag. `scripts/next-version.js` is removed.
