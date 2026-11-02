### Changed

- `npm run typecheck` checks every file in `test/` under `strict` with `checkJs`, in the same `test/tsconfig.json` that lists `**/*.js`; the temporary `test/tsconfig.unchecked.json` is gone and the quality-tools test now also refuses a `@ts-nocheck`, `@ts-ignore` or `@ts-expect-error` in `test/`. Test helpers `test/run-view.js` and `findRow` in `test/usage-fixtures.js` keep the tests short. The tests assert what they asserted before.
- The extra-loop route test in `test/dashboard-actions.test.js` sent three of its five refused requests with lower-case header names that matched nothing the helper returns, so they tested a missing header, not a wrong token or a foreign Origin; they now send the real `Origin` and `X-Factory-Token` headers.
