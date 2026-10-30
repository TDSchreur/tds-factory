### Added
- `tds-factory run sync` rebases the Run branch onto origin's default branch, and Finish refuses a branch that would not merge cleanly into it.
- Changelog entries go in `changelog.d/` fragments, folded into `CHANGELOG.md` at release time by `node scripts/changelog.js release <version>`.
