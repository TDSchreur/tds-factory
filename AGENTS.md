# Agent Skills

This document describes the engineering skills available to agents working in this repo.

## Agent skills

### Issue tracker

Issues live in the repo's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout: `GLOSSARY.md` at repo root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.

## Changelog

Do not edit `CHANGELOG.md` for a change. Add a fragment `changelog.d/<name>.md`; see `changelog.d/README.md`. A maintainer folds the fragments into `CHANGELOG.md` at release time.

## Commands

- Verify-fast: `npm run test:unit` (the unit tests only, without the browser tests, for quick feedback after each Ticket; never Evidence)
- Verify: `npm test` (runs `node --test test/*.test.js` inside its own temporary directory, which `scripts/with-temp-dir.js` removes afterwards, and checks the skills, the guides, Markdown links, ADR numbers, the changelog fragment, the glossary's Avoid terms, the stated Check loop limit, the sync and dashboard code and the names of browser tests).
- Static checks: `npm run check` (runs `npm run lint`, `npm run format:check` and `npm run typecheck`); `shellcheck scripts/install.sh` when that script changes; `npm run test:browser` when the Dashboard changes and `npm run test:package` when installing or packaging changes. CI runs them and `npm test` does not, so run the ones that apply before every Check. `actionlint` when a workflow changes, and `pwsh -NoProfile -Command 'Invoke-ScriptAnalyzer -Path scripts/install.ps1 -Severity Warning,Error -ExcludeRule PSAvoidUsingWriteHost'` (PSScriptAnalyzer 1.25.0) when `scripts/install.ps1` changes; CI pins `actionlint` 1.7.12.
