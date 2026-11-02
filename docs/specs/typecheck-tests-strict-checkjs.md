# Typecheck the tests under strict checkJs

## Problem Statement

[Part 1](typecheck-production-code-strict-checkjs.md) brought `bin/`, `src/`, `scripts/`, `eval/` and `dashboard/` under `strict` with `checkJs: true`. `test/` still has `checkJs: false`, so only the few files that start with `// @ts-check` are checked. With `--checkJs`, `tsc` reports 1,832 errors in 92 of the 101 files in `test/` (the largest are `dashboard-page-browser` 208, `dashboard-detail-responsive-browser` 120, `dashboard.test` 96, `dashboard-a11y-browser` 76, `run-worktrees` 60, `browser.js` 47 and `usage-fixtures.js` 35). A wrong call into production code from a test, or a fake that no longer matches the seam it replaces, gives no signal today. This is part 2 of 2.

## Solution

Every JavaScript file in `test/` is checked under `strict` with `checkJs: true`, target and lib ES2024, Node types, and no per-file opt-outs. The shared test helpers get precise types so call sites need no casts. Tests keep passing and keep asserting the same things. The migration is staged so every Ticket leaves `npm run typecheck` green; the temporary staging config is gone at the end. The choice of JSDoc is already recorded in [ADR 0029](../adr/0029-jsdoc-and-checkjs-rather-than-a-typescript-migration.md); this Run decides nothing new there.

## User Stories

1. As a contributor, I want `npm run typecheck` to check every test file, so that a type error in a test fails the check.
2. As a contributor, I want no `// @ts-nocheck`, `@ts-ignore` or `@ts-expect-error` in `test/`, so that a green check means the tests are checked.
3. As a contributor, I want casts only where runtime narrowing guarantees the type, and explicit `any` only with a one-line reason, so that the tests follow the production rules.
4. As a test author, I want the helpers (`fake-command.js`, `git-repo.js`, `browser.js`, `dashboard-files.js`, `dashboard-token.js`, `dashboard-tokens.js`, `eval-root.js`, `usage-fixtures.js`) to be precisely typed, so that call sites need no casts.
5. As a test author, I want fakes that stand in for `spawnSync` or `execFile` to return the full shape (`SpawnSyncReturns`, or the `child` of `PromiseWithChild`), or the narrower seam type if production code declares one, so that a fake cannot drift from the seam.
6. As a test author, I want the code that runs in the browser page to stay a string handed to the browser helper, so that the Node-side tests need no DOM types and cannot use a DOM global unnoticed.
7. As a maintainer, I want the tests to keep passing and to assert what they asserted before, so that the typing work hides no regression.
8. As a maintainer, I want a test that turns out to assert something wrong fixed and recorded in the changelog fragment `changelog.d/typecheck-tests.md`, so that real findings stay visible.
9. As a reviewer, I want every Ticket to leave typecheck, lint and tests green and well under about 40 KB of diff, so that I can review it.
10. As a contributor, I want a test file that is in no checked tsconfig to fail the quality-tools test, so that nothing falls outside the check.
11. As a new contributor, I want `docs/development.md` to describe the finished layout.

## Implementation Decisions

- **End state.** `test/tsconfig.json`: `checkJs: true`, `strict`, `noEmit`, NodeNext, target and lib ES2024 (same as the root), `types: ["node"]`, `include: ["**/*.js"]`, same excludes as today. No opt-outs.
- **Staged migration.** `test/tsconfig.json` has `checkJs: true` from the first Ticket and its `include` lists only the converted files or groups. The files not yet converted sit in a temporary `test/tsconfig.unchecked.json` (`checkJs: false`, its `include` lists them). `npm run typecheck` runs it as a fourth `tsc -p` call, and `test/quality-tools.test.js` counts it as coverage, so a file in neither config fails. Each Ticket moves its files from the unchecked config to the checked one. The last code Ticket (T5) deletes `test/tsconfig.unchecked.json` and its script entry and sets `include` to `["**/*.js"]`. The quality-tools test then asserts the three-project script again and `checkJs: true` for `test/`.
- **Helpers.** T1 types the eight helpers with JSDoc (`@param`, `@returns`, typedefs for fake invocations, fixtures and the browser handle). Where production code declares a seam type (part 1: for example the `PrProvider` typedef, the run store options), the helpers and fakes use `@import` of that type rather than copying it. Where no narrower seam exists, a fake returns the full Node shape.
- **Browser tests.** The code that runs in the page is a string handed to the browser helper (`page.execute`, `page.waitFor`), so no Node-side test function uses `document` or `window`, and `test/tsconfig.json` keeps `lib: ["ES2024"]`: a Node-side test cannot use a DOM global unnoticed. No `test/page.d.ts` is needed. `docs/development.md` says so.
- **Findings.** A test that asserts something wrong is fixed and noted in `changelog.d/typecheck-tests.md` (`### Changed` for the stricter typecheck; `### Fixed` only for real product bugs). The fragment is created in T1 and extended by later Tickets.
- **Build or borrow.** No dependency is added.
- **Tickets.** T1 helpers, the staged config and the quality-tools test; T2a the four largest `*-browser.test.js` files (`dashboard-page`, `dashboard-detail-responsive`, `dashboard-a11y`, `dashboard-responsive`); T2b the other `*-browser.test.js` files; T3 the other `dashboard*.test.js` files; T4 the `run-*`, `pr-*`, `doctor*`, `update`, `usage` and evidence tests; T5 every remaining file, then remove `tsconfig.unchecked.json`; T6 documentation, blocked by all others.
- **Documents.** From the Sweep (`typecheck`, `checkJs`, `tsconfig`): `docs/development.md` (the type-check paragraph describes the finished layout), `AGENTS.md` (Commands) and `CONTRIBUTING.md` only if the wording changes, `docs/specs/typecheck-production-code-strict-checkjs.md` (its "`test/` follows in a separate Run" statements get a pointer to this Spec), `docs/specs/repo-wide-quality-tools.md` (Ticket 4 note: add a pointer to this Spec for `test/`), `docs/adr/0029-jsdoc-and-checkjs-rather-than-a-typescript-migration.md` (names the three projects; stays true, check it) and `skills/factory/references/exit-checklist.md` (generic; check it stays true). `GLOSSARY.md` needs no change. The changelog fragment is `changelog.d/typecheck-tests.md`.

## Testing Decisions

- The seam is `npm run typecheck`, `npm run lint` and `npm test` (and `npm run test:browser` for T2). Types are tested by `tsc`; behaviour by the existing tests, which must not change what they assert.
- `test/quality-tools.test.js` is extended in T1 to read the staged configs, assert every tracked JS file outside the vendor folders is covered, and (from T5) to assert `checkJs` is `true` for `test/` and that `tsconfig.unchecked.json` is gone.
- Browser tests need a Chromium; if it is missing in the Build environment, list `npm run test:browser` under "Not run".

## Out of Scope

- Migrating to TypeScript, a build step or emit.
- Stricter flags beyond `strict`.
- Behaviour changes to production code, other than fixes of real bugs the typing exposes.
- `vendor/`, `dashboard/vendor/`, `.factory/`, `test/fixtures/`.

## Further Notes

Error counts per group (before the work): the `*-browser.test.js` files about 900 errors; the other `dashboard*.test.js` files about 330; `run-*`, `pr-*`, `doctor`, `update`, `usage` and `evidence` tests about 420; the helpers about 105; the rest about 100. Tickets are cut along those groups and T2 is split so that each stays under about 40 KB of diff.
