# Typecheck the production code under strict checkJs

## Problem Statement

`npm run typecheck` looks like it checks the repo, but `tsconfig.json` has `checkJs: false`, so only the 16 files that carry `// @ts-check` are checked. With `--checkJs`, `tsc` reports 2,814 errors: 671 in `src/` and `bin/`, 221 in `dashboard/`, 79 in `eval/`, 77 in `scripts/` and 1,766 in `test/`. Some are real mismatches, such as `bin/tds-factory.js` passing a `port` option that `startDashboard` does not declare, the Dashboard server calling methods that not every PR provider declares, and `catch` parameters typed `unknown`. A contributor gets no signal for them. This is part 1 of 2: the production code. `test/` follows in a separate Run.

## Solution

Every JavaScript file in `bin/`, `src/`, `scripts/`, `eval/` and `dashboard/` is checked under `strict` with `checkJs: true` and no per-file opt-outs. Shared JSDoc typedefs describe the Run record. The config is split into a root project, a Dashboard project and a `test/` project that keeps today's behaviour; `npm run typecheck` runs all three. Behaviour does not change, except real bugs that `tsc` exposes, each fixed with a test and a changelog line. The choice of JSDoc over TypeScript is recorded in [ADR 0029](../adr/0029-jsdoc-and-checkjs-rather-than-a-typescript-migration.md).

## User Stories

1. As a contributor, I want `npm run typecheck` to check every production file, so that a type error in any of them fails the check.
2. As a contributor, I want no `// @ts-nocheck`, `@ts-ignore` or `@ts-expect-error` in the production code, so that a green check means the code is checked.
3. As a contributor, I want casts only where runtime narrowing already guarantees the type, so that a cast never hides a real mismatch.
4. As a contributor, I want one typedef for the Run record and its parts (verdicts, Evidence, Metrics and the rest of `run.json`), so that every module reads the same shape.
5. As a contributor, I want the typedefs imported with `@import` or `import()` types, so that I do not copy shapes between modules.
6. As a maintainer, I want the real mismatches (the `port` option, the provider union, unchecked `catch` values) fixed, so that the types describe what the code does.
7. As a maintainer, I want each real bug found by `tsc` fixed with a test and a changelog line under Fixed, so that fixes are visible and do not return.
8. As a user of the CLI, I want behaviour unchanged by the typing work, so that nothing regresses.
9. As a Dashboard contributor, I want `dashboard/` checked with the DOM libraries and without Node types, so that browser code cannot use Node APIs unnoticed.
10. As a contributor, I want `src/`, `bin/`, `scripts/` and `eval/` checked as ES2024 with Node types, so that the target matches the supported Node versions.
11. As a contributor, I want `test/` to keep today's opt-in checking until its own Run, so that this Run stays reviewable.
12. As a contributor, I want `npm run typecheck` to run three plain `tsc -p` calls chained with `&&`, so that it works with no build mode and no emit.
13. As a maintainer, I want `vendor/`, `dashboard/vendor/` and `.factory/` excluded, so that third-party and generated code is not checked.
14. As a maintainer, I want a new top-level JavaScript folder to fail the quality-tools test unless a tsconfig covers it, so that nothing falls outside the check.
15. As a package consumer, I want the package to keep shipping plain JavaScript sources, so that Node runs them with no build step.
16. As a reviewer, I want each Ticket to leave typecheck, lint and tests green and to stay well under about 40 KB of diff, so that I can review it.
17. As a new contributor, I want `docs/development.md` and `AGENTS.md` to describe the finished layout, so that I know how to check and annotate a file.

## Implementation Decisions

- **Config layout.** The root project covers the root `*.js` files and `bin/`, `src/`, `scripts/` and `eval/`, with `checkJs: true`, target and lib ES2024 and Node types. A `dashboard/` project covers its own `*.js` files with `checkJs: true`, lib ES2024, DOM and DOM.Iterable, and no Node types. A `test/` project keeps `checkJs: false`, so only files with `// @ts-check` are checked, until Run 1b. All three use `strict`, `noEmit` and NodeNext module resolution as today. `vendor/`, `dashboard/vendor/` and `.factory/` are excluded.
- **Script.** `npm run typecheck` chains the three projects with plain `tsc -p` calls and `&&`. No `tsc --build`, no emit.
- **Run record types.** The shared typedefs (Run, Verdict, Evidence and Verify, Metrics, and every other part of `run.json` as described in the Run schema reference) live in the Run record module and are imported by the run folder, lifecycle, evidence, Dashboard and PR provider modules and by the Dashboard model.
- **Typing rules.** No per-file opt-outs. Casts only where runtime narrowing already guarantees the type. Options types gain the fields callers pass (for example `port`). Provider unions get a shape that every member satisfies, or the callers narrow first. `catch` values are narrowed before use.
- **Behaviour.** Unchanged. A real bug exposed by `tsc` is fixed in the Ticket that finds it, with a test and a Fixed line in a changelog fragment.
- **Build or borrow.** No dependency is added; `typescript` is already a dev dependency. The package keeps shipping sources (ADR 0029).
- **Tickets.** T1: Run record typedefs, `src/`, `bin/` and the tsconfig split with the ES2024 target (split into T1a typedefs and run modules and T1b the rest if the diff passes about 40 KB). T2: `scripts/` and `eval/`. T3: `dashboard/` with its own tsconfig. T4: the documentation Ticket, blocked by the others.
- **Documents.** From the Sweep (`typecheck`, `checkJs`, `@ts-check`): `docs/development.md` (the type-check paragraph, which lists the files that are still excluded), `AGENTS.md` (Commands, only if the wording changes), `CONTRIBUTING.md` (only if needed), `skills/factory/references/exit-checklist.md` (names the typecheck command generically; check that it stays true), and the canonical spec `docs/specs/repo-wide-quality-tools.md` (Ticket 4 says `checkJs` stays `false`; add a note that it is superseded by this Spec, with the pointer). `docs/specs/type-checking-and-npm-updates.md` and `docs/specs/exit-checklist-static-checks.md` are history and stay as they are. `test/quality-tools.test.js` reads `tsconfig.json`'s `include` and must read all three configs. The `GLOSSARY.md` needs no change: the work adds no domain term.

## Testing Decisions

- A good test checks external behaviour: `npm run typecheck` exits clean, and the CLI and Dashboard behave as before. Types themselves are tested by `tsc`.
- The seam is the existing one: `npm run typecheck`, `npm run lint` and `npm test` in the Verify command. Every Ticket leaves all three green.
- Each real bug found gets a regression test in the test file of its module, in the style of the existing unit tests.
- `test/quality-tools.test.js` is extended to read the three tsconfigs and to assert that every tracked JS file outside the vendor folders is covered by one of them.

## Out of Scope

- `test/` under `checkJs` (Run 1b).
- Migrating to TypeScript or adding a build step.
- `vendor/`, `dashboard/vendor/` and `.factory/`.
- Stricter flags beyond `strict`, such as `noUncheckedIndexedAccess`.
- Behaviour changes other than fixes of real bugs.

## Further Notes

Run record typedefs go in the existing Run record module, which today holds the validation. The history is in [the earlier type-checking spec](type-checking-and-npm-updates.md) and [the repo-wide quality tools spec](repo-wide-quality-tools.md).
