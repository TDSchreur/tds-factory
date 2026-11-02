### Changed

- `npm run typecheck` checks the shared test helpers (`test/fake-command.js`, `git-repo.js`, `browser.js`, `dashboard-files.js`, `dashboard-token.js`, `dashboard-tokens.js`, `eval-root.js` and `usage-fixtures.js`) under `strict` with `checkJs`; the other test files follow in a temporary project, `test/tsconfig.unchecked.json`, until they are converted. The tests assert what they asserted before.
