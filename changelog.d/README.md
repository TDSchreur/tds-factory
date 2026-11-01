# Changelog fragments

Add one file here per change, named after the Run or the change, for example `changelog.d/add-run-sync.md`. Do not edit `CHANGELOG.md` in a PR: two PRs that edit the same lines conflict.

```markdown
### Added

- `tds-factory run sync` rebases the Run branch onto origin's default branch.

### Fixed

- Something that was broken.
```

Use the headings `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` and `Security`. Each entry is one `- ` line; indent a second line to continue it.

When a Release is ready, a maintainer opens one PR that runs `node scripts/changelog.js release <version>`. It writes the new version section from the fragments and from anything still under `## [Unreleased]`, and deletes the fragments.
