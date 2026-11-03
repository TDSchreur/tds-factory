## Problem Statement

The Check of the multi-Project Dashboard ([Spec](multi-project-dashboard.md), PR #482) left open a set of non-blocking findings. The Project registry's lock and files can be tampered with or raced by another local process, a failed registry write leaves the printed URL without `?project=<id>`, removing a Project blocks the server's event loop, the CLI prints a version string it got from another process unchecked, the own-Project exception is undocumented and answers a confusing 404, and a few documents use the wrong word or omit the new modules. Worse, the Dashboard of the user shows dozens of rows such as `git-repo-0EQUsd`, "The folder of this Project is missing": tests that start Runs in temporary repositories register them in the user's real registry whenever they run without `TDS_FACTORY_CONFIG_DIR`.

## Solution

Stop tests from polluting the real registry, show missing Projects as one summary row with a cleanup button, harden the registry and the launch flow, make the own-Project exception explicit, and bring the documents in line. No new feature and no change to what the user sees on the page.

## User Stories

1. As a Factory user, I want the Project registry and its lock to be private to me, so that another local user cannot read, replace or steal them.
2. As a Factory user, I want a lock to be released only by the process that took it, so that a slow process never deletes the lock of another one.
3. As a Factory user, I want two repositories that would get the same Project id to stay apart with a warning, so that one never overwrites the other.
4. As a Factory user, I want `tds-factory dashboard` to print the `?project=<id>` link even when the registry could not be written, so that I still land on my Project.
5. As a Factory user, I want a registry or Git problem never to fail `run start`, so that a read-only home folder or a bare repository blocks no work.
6. As a Factory user, I want removing a Project not to freeze the Dashboard for other Projects, so that polling continues while the registry lock is waited for.
7. As a Factory user, I want a clear message when I remove the Dashboard's own Project and the registry never held it, so that I understand why nothing was removed.
8. As a Factory user, I want a version from another process to be printed only when it is a plain version, so that a hostile local server cannot write control characters to my terminal.
9. As a Factory user, I want tests never to add Projects to my real registry, so that my Dashboard shows only my own Projects.
10. As a Factory user, I want my active Projects as Project rows and all missing Projects in one collapsed summary row, so that dozens of leftovers do not fill the page.
11. As a Factory user, I want one **Remove all missing** button, after a confirmation, so that I clean up a long list in one step without touching any folder.
12. As a keyboard and screen reader user, I want the summary row and its button to be labelled and operable by keyboard, so that the cleanup is accessible.
13. As a Factory maintainer, I want the Spec, the Dashboard guide and the Glossary to use the same words and to name the registry and launch modules, so that a reader finds the code from the documents.

## Implementation Decisions

- **Lock.** The lock file holds a unique token (random, with the pid). A stale lock (older than the existing limit) is taken over only while a process holds a separate guard lock (`projects.json.lock.takeover`) created with `wx`; under that guard it re-checks that the stale lock is still the same one before removing it and then claims it with `wx`. Release deletes the lock only when it still holds our token. The lock wait, stale limit and the warning on timeout stay as they are.
- **Files.** The registry folder is created with mode 0700 and the registry, state and lock files with 0600. On non-Windows hosts, an existing config folder is tightened to 0700 (symlinks are left unchanged). The staging file has an unpredictable name (random suffix) and is written with flag `wx`, so an existing file or link is never followed or overwritten. Modes are best-effort on Windows.
- **Project id.** The id is 12 hex characters of the hash instead of 8 (ADR 0033 and the guide say "short hash" and stay true). `join` refuses to add a path whose id already exists for another path: it warns, returns no Project and never overwrites. Ids of an existing registry are computed, not stored, so no migration is needed; a bookmarked `?project=` link with an 8-character id stops matching and the page falls back to its normal order.
- **`join` and `mainCheckout`.** The `mainCheckout` call moves inside the try block so that no registry or Git problem fails `run start` (the warning names the folder given). The fallback of `mainCheckout` in `src/run-folder.js` (Git failed, or a bare repository) returns `path.normalize(dir)`, like the normal path.
- **URL after a failed write.** `launchDashboard` computes the Project id from the main checkout path when `join` returned nothing, and prints `?project=<id>` anyway. A registry that cannot be written is still a warning. The server serves its own Project when the registry does not hold it, so the link works.
- **Own-Project exception.** `createProjectHub.known()` keeps treating the server's own Project as known when the registry does not list it (for example a read-only home folder). It is documented in ADR 0033 as a dated note on the same ADR (no new ADR) and in the Dashboard guide. `DELETE /api/projects/<ownId>` for such an unregistered own Project answers HTTP 409 with a message that says the Project is not in the registry, so there is nothing to remove, and that it is served because the Dashboard was started there. Any other unknown id stays 404.
- **No blocking wait on the server.** The registry gets an async removal (`removeAsync`) whose lock wait uses timers instead of `Atomics.wait`; `hub.remove` and the DELETE handler await it. The synchronous `join` and `remove` keep their blocking wait, because the CLI has no event loop to protect. The lock logic is one implementation with a pluggable sleep, not two copies.
- **Foreign version.** The CLI uses the `version` from `/api/info` only when it matches a strict semver regex (`MAJOR.MINOR.PATCH` with an optional pre-release and build part, nothing else). The `/api/info` probe reads at most 64 KiB and calls `reader.cancel()` when that cap is exceeded. Anything else is treated as unknown: no older-version warning and the value is never printed. The printed text is stripped of control characters either way. The state file's `version` gets the same check.
- **Wording.** The Spec `multi-project-dashboard.md` and the Dashboard guide call the Dashboard "the Dashboard", not "the board", and so does the Glossary entry of the Run detail drawer. The `#board` element id stays.
- **Test isolation.** The cause of the stale rows is tests that run `tds-factory run start` or the Dashboard and so register their `git-repo-XXXXXX` temporary repositories in the real registry when `TDS_FACTORY_CONFIG_DIR` is unset (`node --test` directly, or one test file); `scripts/with-temp-dir.js` covers only `npm test`. The least magical protection is explicit and test-side: `test/git-repo.js`, which every test that makes a repository imports, sets `TDS_FACTORY_CONFIG_DIR` to a temporary folder (removed at exit) when it is unset, so the folder is inherited by spawned CLIs. A guard test lists the test files that spawn `bin/tds-factory.js`, call `launchDashboard`, `startDashboard` or `openProjectRegistry` without a `dir`, and fails when such a file neither imports `test/git-repo.js` nor sets `TDS_FACTORY_CONFIG_DIR` itself, so a new unisolated test fails `npm test`. Rejected: making `factoryConfigDir()` refuse the real folder when `NODE_TEST_CONTEXT` is set, because production code would then behave differently under a test runner. The real `~/.config` registry is never touched by Build or its tests.
- **Missing Projects.** `/api/views` keeps the same top-level shape (`projects`) and now includes `path` per Project in each entry. The page shows a Project row for every Project whose folder exists, in the existing order, and one summary row at the bottom for all missing Projects: "N missing Projects", collapsed by default (the choice is kept in `localStorage` like a Project row), a labelled region with a real toggle button. Expanded, it lists each missing Project's name and path with its own **Remove** button. A **Remove all missing** button in the header of the summary row asks for confirmation with the existing destructive-action dialog (as Delete all does), naming the count and saying that no folder or Run is touched. The summary row is absent when nothing is missing; a single missing Project is also shown in it ("1 missing Project").
- **Cleanup route.** `DELETE /api/projects/missing` (an id is hex, so it never collides) removes every registry entry whose folder is missing at that moment and answers the number removed. It is a write route with the full ADR 0017 guard (Host, Origin, Session token), takes no body and no path, uses the async registry removal under one lock and never touches a folder; a Project whose folder came back is kept. The own-Project exception (above) keeps its own Project and is never reported removed when not in the registry.
- **CLI.** There is no command that lists or removes Projects (only `tds-factory dashboard`), so no CLI cleanup is added.
- **Documents.** The `/` row of the route table in the Dashboard guide mentions the Project row. One sentence in `docs/development.md` names `src/project-registry.js` (registry, lock, state file) and `src/dashboard-launch.js` (reuse or start of the one Dashboard). The Dashboard guide describes the lock token, the file modes, the 12-character id and the collision warning. A changelog fragment is added.
- **Build or borrow.** The lock takeover is hand-rolled on top of a `wx` guard file, `wx` lock claim, and `crypto.randomBytes`; all are in Node 24. The version check is a hand-rolled regex with a required adversarial test (control characters, newlines, very long and non-semver strings).

## Testing Decisions

- Test observable behavior at the existing seams: the registry module on temporary folders, the launch flow with a fake `/api/info`, and the Dashboard HTTP seam. No tests of private helpers.
- Registry: a lock whose token is not ours is not deleted on release; two racing takeovers of one stale lock end with one winner; file and folder modes (skipped on Windows); an existing staging path is not followed; an id collision warns and keeps the first path; `join` inside a bare repository or with a failing Git returns without throwing; `mainCheckout` fallback is normalized.
- Launch: after a failed registry write the printed URL carries `?project=<id>`; a foreign `version` with control characters, a newline or a non-semver value is not printed and gives no older warning.
- Server: `DELETE` of an unregistered own Project is 409 with the message; an unknown id is 404; a `DELETE` that waits for a held lock does not stop `/api/info` from answering in the meantime; the guard of ADR 0017 still refuses a bad Origin, Host or token on that route.
- Isolation: a guard test over the test files as above (with a fixture of a file that lacks isolation, the guard fails); a direct `node --test test/<file>` run leaves the registry folder named by the default untouched (checked with a temporary `HOME`/`XDG_CONFIG_HOME`).
- Cleanup route: removes only entries whose folder is missing, keeps active ones, answers the count, is refused without the Session token or with a bad Origin or Host, and touches no folder; a Project whose folder returned is kept.
- Browser: active Projects are Project rows, missing ones are one collapsed summary row, expand lists them with Remove, **Remove all missing** confirms and then the row is gone, the toggle and button work by keyboard and are named; no summary row without missing Projects. Browser test names follow the repository's rule for names.
- Verify with `npm test`, `npm run check` and `npm run test:browser`.

## Out of Scope

- A standalone `--port` server reading the registry.
- Card button names and a per-row Delete all.
- Older Specs that mention `/api/runs`.
- Any other change to the page's behavior or layout; a Project CLI to list or remove Projects.

## Further Notes

The findings come from the three Checks of PR #482 (Run `2026-11-03-one-dashboard-for-every-project`). The user said to continue with the left open points; every design question above was settled in Define without further questions.

Documents: `GLOSSARY.md` (Project row and missing Project wording), `dashboard/help.js`, `test/git-repo.js`, `scripts/with-temp-dir.js`, `docs/specs/multi-project-dashboard.md`, `docs/dashboard.md`, `docs/development.md`, `docs/adr/0033-one-dashboard-serves-every-registered-project.md`, `src/project-registry.js`, `src/dashboard-launch.js`, `src/dashboard-projects.js`, `src/dashboard-handlers.js`, `src/run-folder.js`, `bin/tds-factory.js` (command line help of `dashboard`, unchanged unless the Sweep shows otherwise), and a `changelog.d/` fragment.

This is cut into five Tickets:

1. **Registry hardening**: lock token and guarded stale-lock takeover, file modes and `wx` staging, 12-character id with collision handling, `join` and `mainCheckout` changes, async removal in the registry. Blocked by none.
2. **Launch and server**: the URL after a failed write, the version check, the own-Project 409 and the non-blocking `hub.remove` and DELETE. Blocked by Ticket 1.
3. **Test isolation**: `test/git-repo.js` default config folder, the guard test. Blocked by none.
4. **Missing Projects summary row and cleanup**: the route and the page (needs Ticket 1's async removal). Blocked by Ticket 1.
5. **Documentation**: wording, route table, module sentence, ADR 0033 note, guide, Glossary, help text and changelog fragment. Blocked by Tickets 1 to 4.

## Update 2026-11-03 (Rework 1)

`/api/views` is not byte-for-byte unchanged: each Project entry includes `path` (main checkout path). The top-level response shape and semantics stay the same.

## Update 2026-11-03 (Rework 2)

The stale-lock takeover now uses a guarded takeover (`projects.json.lock.takeover`): under that guard, a process re-verifies that the lock is still the same stale lock before removing it and claiming it with `wx`.
