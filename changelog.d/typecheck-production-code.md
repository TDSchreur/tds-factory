### Changed

- `npm run typecheck` checks all the production code (`bin/`, `src/`, `scripts/`, `eval/` and `dashboard/`) under `strict` with `checkJs`, in three TypeScript projects (root, Dashboard and `test/`), and the Run record has shared JSDoc types in `src/run-record.js`. The code behaves as before.
