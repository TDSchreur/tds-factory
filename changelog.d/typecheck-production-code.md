### Changed

- `npm run typecheck` checks all the production code (`bin/`, `src/`, `scripts/`, `eval/` and `dashboard/`) under `strict` with `checkJs`, in three TypeScript projects (root, Dashboard and `test/`), and the Run record has shared JSDoc types in `src/run-record.js`. The code behaves as before.

### Fixed

- `tds-factory doctor` reports a package that ships no `factory-check` agent as a missing agent, and a `package.json` whose `engines.node` names no version as a failed `cli` check, instead of stopping on a TypeError.
- `npm run test:package` says `npm pack made no tarball` when `npm pack` leaves no tarball, instead of stopping on a TypeError.
- `run reviews` and the project review verdict say that the Run records no base commit instead of stopping on a TypeError.
