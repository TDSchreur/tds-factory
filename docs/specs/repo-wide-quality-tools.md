## Problem Statement

ESLint, Prettier and `tsc` only partly cover the repository. `npm run format:check` checks `eslint.config.js` and `package.json`; a full `prettier --check .` reports 201 files. `tsconfig.json` includes only `src/tree-hash.js`. ESLint uses `eslint:recommended` with relaxed rules. CI runs the three checks but `npm test` does not, there is no `.editorconfig`, and there is no single command to run them.

## Solution

Bring the whole repository (`bin/`, `src/`, `scripts/`, `eval/`, `test/`, `dashboard/`) under the quality tools in five Tickets, in order. Every Ticket leaves `npm run lint`, `npm run format:check` and `npm run typecheck` green. Nothing changes in the behavior of the CLI or the Dashboard. `vendor/`, `dashboard/vendor/` and `.factory/` are never formatted or linted.

## User Stories

1. As a contributor, I want all JS and JSON formatted by Prettier and checked in CI, so that style is never a review topic.
2. As a maintainer, I want the one-off formatting commit listed in `.git-blame-ignore-revs`, so that `git blame` stays useful.
3. As a contributor, I want YAML, CSS and HTML checked too, so that every non-vendored web and workflow file is consistent.
4. As a maintainer, I want an explicit decision on Markdown formatting, so that docs and Skills are not reflowed by accident.
5. As a contributor, I want `eqeqeq`, `prefer-const`, `no-var` and `no-shadow` enforced, so that common bug classes are caught.
6. As a maintainer, I want each relaxed ESLint rule either removed or explained by a comment, so that no rule stays off without a reason.
7. As a contributor, I want `// @ts-check` per file with a growing `tsconfig.json` include list, so that typechecking spreads gradually without casts or blanket `@ts-ignore`.
8. As a contributor, I want `npm run check` to run lint, format check and typecheck, so that one command covers the static checks.
9. As a contributor, I want an `.editorconfig` that matches `.prettierrc.json`, so that editors agree with Prettier.
10. As a contributor, I want a pre-commit hook on staged files, but only if it does not slow or block the Factory's own commits and worktrees.
11. As a maintainer, I want `npm test` to check that the docs name the new scripts and that a new top-level JS directory cannot fall outside the lint, format and typecheck globs.

## Implementation Decisions

- **Ticket 1.** One `prettier --write` over `**/*.{js,json}` as a pure formatting commit; its hash goes in `.git-blame-ignore-revs` (in a following commit, since a hash cannot be in its own commit). `format:check` becomes `prettier --check "**/*.{js,json}"` and `format` defaults to `.`. Tests that read source text must still pass unchanged.
- **Ticket 2.** `format:check` extends to `**/*.{js,json,yml,yaml,css,html}`. Markdown: try `proseWrap: preserve`; if the doc checks (skills, guides, Markdown links, ADR numbers, glossary) fail or Markdown reflows too much, exclude `skills/` and `agents/` from the check, say so in the Ticket and record an ADR only if it is a real trade-off.
- **Ticket 3.** Add `eqeqeq`, `prefer-const`, `no-var`, `no-shadow` one by one, each fixed in its own commit. Re-evaluate the relaxed rules in `eslint.config.js`; remove those no longer needed and keep a comment for each that stays.
- **Ticket 4.** `checkJs` stays `false`; files are added to the `include` list and carry `// @ts-check`, starting with small pure modules (paths, rules, flow, evidence). Cover as much of `src/` as is reasonable without casts or blanket `@ts-ignore`; `test/` and `eval/` last and skipped if too costly. Report excluded files and why.
- **Ticket 5.** `npm run check`; update `AGENTS.md` (Commands) and `CONTRIBUTING.md`; add `.editorconfig`; husky + lint-staged only if it does not disturb Factory commits and worktrees, otherwise skip and say why; a test that the docs name the scripts and that a new top-level JS directory is covered by the globs. A changelog fragment in `changelog.d/`; `CHANGELOG.md` is not edited.
- `files` in `package.json` stays unchanged; `npm run test:package` must pass if packaging is touched.

## Testing Decisions

- `npm test` (existing suite unchanged by the formatting), `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test:browser`, `actionlint` if a workflow changes, and `npm run check` in a clean checkout.
- A new test in `test/` for the Ticket 5 coverage guarantees (scripts documented; no top-level JS directory outside the globs).

## Out of Scope

- Behavior changes to the CLI or Dashboard.
- Fixing every type error at once.
- Formatting or linting `vendor/`, `dashboard/vendor/` or `.factory/`.
