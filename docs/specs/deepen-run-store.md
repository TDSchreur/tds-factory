# Deepen Run storage into a Run store

## Problem Statement

Rules about Runs on disk are split across two modules. The Dashboard re-implements the storage guards (unlinked storage, locking), reads Run records on its own, and decides which Runs may be deleted. The Run lifecycle therefore lives partly in the Dashboard, and a fix to storage safety has to be made in more than one place.

## Solution

One Run store owns every read and write of the Runs under `.factory/runs`. The CLI and the Dashboard become callers of its interface. Behaviour is unchanged: this is a refactor.

## User Stories

1. As a developer, I want one module to own all access to Run folders, so that a storage-safety fix is made once.
2. As a developer, I want the Dashboard to ask the Run store to delete a Run, so that deletion rules are not re-implemented in HTTP code.
3. As a developer, I want the CLI `run start` and `run update` to go through the Run store, so that they share the same guards as the Dashboard.
4. As a developer, I want Runs in `done` or `abandoned` to stay deletable and every other Run to stay protected, so that no behaviour changes.
5. As a developer, I want deletion to refuse linked storage, linked Run folders and linked Run records, so that the Dashboard cannot delete outside the project.
6. As a developer, I want deletion and updates of the same Run to exclude each other, so that a Run is not deleted mid-update.
7. As a developer, I want broken or half-written Run records listed as unreadable instead of failing the list, so that history stays visible.
8. As a developer, I want Stage summary files read only from inside a Run folder and only as Markdown, so that the Dashboard cannot serve other files.
9. As a developer, I want the Run store to return raw records, so that the Dashboard alone decides how a card looks.
10. As a developer, I want Run store tests that need no HTTP server and no spawned CLI, so that lifecycle rules are tested at one interface.
11. As an agent, I want `tds-factory run start` and `run update` to behave exactly as before, so that the Factory skill needs no change.
12. As a maintainer, I want `GLOSSARY.md` to name the Run store, so that docs and code use one word.

## Implementation Decisions

- New module, the Run store, opened for a project directory. Each call checks the project's Run storage as it runs, because Runs can appear after the store is opened.
- Interface: start, update, list, read a Stage summary file, and remove a Run.
- Remove reports one of: deleted, not found, not allowed (including linked storage, a Run not in `done` or `abandoned`, and an unreadable record).
- List returns each Run with its id, raw record or an unreadable flag, and its Markdown summary names in Stage order.
- Validation, waiting rules, atomic replace, locking and linked-storage refusal move into the Run store unchanged. The Run record module is folded into it and removed.
- The Dashboard's interpretation of a raw record into a card moves into the Dashboard module, which now calls the Run store for all data.
- The HTTP routing, Host and Origin checks, the page and its fallback stay in the Dashboard.
- Which Runs may be deleted does not change. Deleting a stuck `running` Run from the Dashboard is a separate decision.
- Add **Run store** to `GLOSSARY.md`. No ADR.
- Update the canonical Dashboard Spec and README wording where they name the module that owns Run records.

## Testing Decisions

- A good test crosses an interface and asserts outcomes, never internals.
- New Run store tests cover validation, preserved unknown fields, waiting consistency, failed replacement, linked storage, locking between delete and update, delete rules, unreadable records and summary-file reads.
- Dashboard HTTP tests keep only HTTP behaviour: routes, Host and Origin checks, status codes, and card interpretation through `/api/views`.
- One end-to-end CLI test remains for `run start` and `run update`.
- Prior art: the existing run-record, dashboard and sync tests with the Node test runner and temporary projects.
- Seams: the Run store interface, with the Dashboard HTTP interface and the CLI above it kept as they are.

## Out of Scope

- Deleting `running` Runs, stale-Run cleanup or any other lifecycle change.
- Changing Run record fields, the Dashboard's look or the CLI's arguments.
- Moving Stage and Agent target names into one module.
- New dependencies or a build step.

## Further Notes

This reverses one point of `deepen-run-record.md`, which has the Dashboard share interpretation with the Factory tooling. Only the Dashboard interprets records, so interpretation moves there.
