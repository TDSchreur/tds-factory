### Added
- Build ends with an Exit checklist, after the last Ticket and after every Rework: a term sweep, the required artifacts, a story trace, a security check and a self-check of its own diff. It records no verdict or Evidence; Check still owns the review.
- `npm test` checks that relative Markdown links resolve, ADR numbers are unique, a change to `src/`, `skills/` or `agents/` has a changelog fragment, the docs use no glossary Avoid term and state the Check loop limit as the code does, and browser tests are named so CI runs them.

### Changed
- Rework sweeps the docs again, reads its own diff and fixes cheap LOW findings in the area instead of leaving them.
- The Dashboard theme and page tests are renamed to `*-browser.test.js` so the CI browser job runs them.
