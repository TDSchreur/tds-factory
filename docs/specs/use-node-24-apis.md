# Use the Node 24 APIs

## Problem Statement

`tds-factory` requires Node 24, but the code still carries patterns from older Node lines: `fileURLToPath(import.meta.url)`, hand-written directory walks, `mkdtemp` with `try`/`finally` and `rmSync`, a `process.argv[1]` comparison for "is this the main module", hand-wrapped `listen` and `close` promises, a `setTimeout` promise for sleeping, and a reverse-and-find for the last match.

## Solution

Replace each pattern with the Node 24 API that does the same thing, and raise the minimum to Node 24.4, the first line that has `fs.mkdtempDisposableSync`. Behaviour does not change and stays Windows-safe.

## User Stories

1. As a maintainer, I want `engines.node` to be `>=24.4`, so that the minimum names the Node release the code needs.
2. As a maintainer, I want the CI and release matrices to test the minimum (`24.4`) and `lts/*`, so that the lowest supported Node is exercised.
3. As a contributor, I want `import.meta.dirname` instead of `fileURLToPath(import.meta.url)`, so that paths are read without a conversion.
4. As a contributor, I want directory walks that use `fs.readdirSync` with `recursive` or `fs.globSync`, so that no hand-written walk is left, and I want the symlink checks and the sort order kept.
5. As a contributor, I want `using` with `fs.mkdtempDisposableSync`, so that a temporary directory is removed on every exit path without a `finally`.
6. As a contributor, I want `import.meta.main`, `events.once`, `timers/promises` and `findLast` where they replace hand-written code.
7. As a contributor, I want ESLint, Prettier and `tsc` to accept `using`, so that the checks keep passing.
8. As a user, I want no change in behaviour on Linux, macOS or Windows.

## Implementation Decisions

- **Minimum.** `engines.node` becomes `>=24.4` (`fs.mkdtempDisposableSync` arrived in 24.4, `import.meta.main` in 24.2). The CI and release matrices change `'24'` to `'24.4'`. The documents that name the minimum say Node 24.4. `scripts/install.sh`, `install.ps1` and `doctor` keep reading the major only.
- **`import.meta.dirname`.** Replaces `dirname(fileURLToPath(import.meta.url))` and `fileURLToPath(new URL('..', import.meta.url))` in `src/paths.js`, `src/dashboard.js`, `scripts/dev-install.js`, `eval/run.js`, `eval/lib/fixture.js`, `test/eval-root.js` and `test/dashboard-served-assets.test.js`. `import.meta.url` stays where a URL is wanted (`new URL(..., import.meta.url)` for reading files).
- **Walks.** The recursive document walk in `src/run-sweep.js` and the test file list in `scripts/test-unit.js` use `fs.globSync`; the order stays sorted. `fs.readdirSync(..., { recursive: true })` follows linked folders and cannot skip a folder, so it is not used. `globSync` follows no link and prunes with `exclude`, but `**/*` alone leaves out dotfiles, so the sweep also passes `**/.*` and `**/.*/**`. The regular-file tree in `src/project-reviews.js` keeps its hand-written walk: it refuses links in untrusted project input and the `globSync` dotfile and link behaviour is not worth the risk there. `scripts/doc-checks.js` is out of scope.
- **Temporary directories.** `src/update.js`, `scripts/test-package.js` and `scripts/dev-install.js` use `using tmp = fs.mkdtempDisposableSync(...)` and `tmp.path`. `src/evidence.js` and `eval/lib/fixture.js` create a directory that outlives the function (it is returned), so they stay as they are.
- **Smaller replacements.** `import.meta.main` in `scripts/changelog.js`; `events.once(server, 'listening')` and `events.once(server, 'close')` for the Dashboard wrappers; `timers/promises` `setTimeout` for the default `sleep` in `src/update.js`; `findLast` where `src/evidence.js` takes the last match.
- **Tooling.** `tsc`, ESLint and Prettier accept `using` with the existing `ES2024` target and `lib` (`@types/node` brings the disposable types), so no config changes.
- **Line numbers.** The line numbers in the request were stale; each pattern is found by what it does.

## Testing Decisions

No new tests: the existing suite exercises each replaced code path. The checks are `npm test`, `npm run check` and `npm run test:package`.

## Out of Scope

Changing `install.sh`, `install.ps1` or `doctor` to compare the minor version. Other refactors.

## Documents

`package.json`, `test/ci.test.js`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `README.md`, `docs/install.md`, `docs/development.md`, `docs/releasing.md`, `changelog.d/use-node-24-apis.md`.
