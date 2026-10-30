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

- Verify: `npm test` (runs `node --test test/*.test.js`, which checks the skills, the guides, Markdown links, ADR numbers, the changelog fragment, the glossary's Avoid terms, the stated Check loop limit, the sync and dashboard code and the names of browser tests).
