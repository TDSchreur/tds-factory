## Problem Statement

The Check of the multi-Project Dashboard ([Spec](multi-project-dashboard.md), PR #482) left open a set of non-blocking findings. The Project registry's lock and files can be tampered with or raced by another local process, a failed registry write leaves the printed URL without `?project=<id>`, removing a Project blocks the server's event loop, the CLI prints a version string it got from another process unchecked, the own-Project exception is undocumented and answers a confusing 404, and a few documents use the wrong word or omit the new modules.

## Solution

Harden the registry and the launch flow, make the own-Project exception explicit, and bring the documents in line. No new feature and no change to what the user sees on the page.

## User Stories

1. As a Factory user, I want the Project registry and its lock to be private to me, so that another local user cannot read, replace or steal them.
2. As a Factory user, I want a lock to be released only by the process that took it, so that a slow process never deletes the lock of another one.
3. As a Factory user, I want two repositories that would get the same Project id to stay apart with a warning, so that one never overwrites the other.
4. As a Factory user, I want `tds-factory dashboard` to print the `?project=<id>` link even when the registry could not be written, so that I still land on my Project.
5. As a Factory user, I want a registry or Git problem never to fail `run start`, so that a read-only home folder or a bare repository blocks no work.
6. As a Factory user, I want removing a Project not to freeze the Dashboard for other Projects, so that polling continues while the registry lock is waited for.
7. As a Factory user, I want a clear message when I remove the Dashboard's own Project and the registry never held it, so that I understand why nothing was removed.
8. As a Factory user, I want a version from another process to be printed only when it is a plain version, so that a hostile local server cannot write control characters to my terminal.
9. As a Factory maintainer, I want the Spec, the Dashboard guide and the Glossary to use the same words and to name the registry and launch modules, so that a reader finds the code from the documents.

## Implementation Decisions

- **Lock.** The lock file holds a unique token (random, with the pid). A stale lock (older than the existing limit) is taken over by an atomic rename to a unique name, then deleted; only one process wins the rename. Release deletes the lock only when it still holds our token. The lock wait, stale limit and the warning on timeout stay as they are.
- **Files.** The registry folder is created with mode 0700 and the registry, state and lock files with 0600. The staging file has an unpredictable name (random suffix) and is written with flag `wx`, so an existing file or link is never followed or overwritten. Modes are best-effort on Windows.
- **Project id.** The id is 12 hex characters of the hash instead of 8 (ADR 0033 and the guide say "short hash" and stay true). `join` refuses to add a path whose id already exists for another path: it warns, returns no Project and never overwrites. Ids of an existing registry are computed, not stored, so no migration is needed; a bookmarked `?project=` link with an 8-character id stops matching and the page falls back to its normal order.
- **`join` and `mainCheckout`.** The `mainCheckout` call moves inside the try block so that no registry or Git problem fails `run start` (the warning names the folder given). The fallback of `mainCheckout` in `src/run-folder.js` (Git failed, or a bare repository) returns `path.normalize(dir)`, like the normal path.
- **URL after a failed write.** `launchDashboard` computes the Project id from the main checkout path when `join` returned nothing, and prints `?project=<id>` anyway. A registry that cannot be written is still a warning. The server serves its own Project when the registry does not hold it, so the link works.
- **Own-Project exception.** `createProjectHub.known()` keeps treating the server's own Project as known when the registry does not list it (for example a read-only home folder). It is documented in ADR 0033 as a dated note on the same ADR (no new ADR) and in the Dashboard guide. `DELETE /api/projects/<ownId>` for such an unregistered own Project answers HTTP 409 with a message that says the Project is not in the registry, so there is nothing to remove, and that it is served because the Dashboard was started there. Any other unknown id stays 404.
- **No blocking wait on the server.** The registry gets an async removal (`removeAsync`) whose lock wait uses timers instead of `Atomics.wait`; `hub.remove` and the DELETE handler await it. The synchronous `join` and `remove` keep their blocking wait, because the CLI has no event loop to protect. The lock logic is one implementation with a pluggable sleep, not two copies.
- **Foreign version.** The CLI uses the `version` from `/api/info` only when it matches a strict semver regex (`MAJOR.MINOR.PATCH` with an optional pre-release and build part, nothing else). Anything else is treated as unknown: no older-version warning and the value is never printed. The printed text is stripped of control characters either way. The state file's `version` gets the same check.
- **Wording.** The Spec `multi-project-dashboard.md` and the Dashboard guide call the Dashboard "the Dashboard", not "the board", and so does the Glossary entry of the Run detail drawer. The `#board` element id stays.
- **Documents.** The `/` row of the route table in the Dashboard guide mentions the Project row. One sentence in `docs/development.md` names `src/project-registry.js` (registry, lock, state file) and `src/dashboard-launch.js` (reuse or start of the one Dashboard). The Dashboard guide describes the lock token, the file modes, the 12-character id and the collision warning. A changelog fragment is added.
- **Build or borrow.** The lock takeover is hand-rolled on top of `fs.rename`, `open` with `wx`, and `crypto.randomBytes`; all are in Node 24. The version check is a hand-rolled regex with a required adversarial test (control characters, newlines, very long and non-semver strings).

## Testing Decisions

- Test observable behavior at the existing seams: the registry module on temporary folders, the launch flow with a fake `/api/info`, and the Dashboard HTTP seam. No tests of private helpers.
- Registry: a lock whose token is not ours is not deleted on release; two racing takeovers of one stale lock end with one winner; file and folder modes (skipped on Windows); an existing staging path is not followed; an id collision warns and keeps the first path; `join` inside a bare repository or with a failing Git returns without throwing; `mainCheckout` fallback is normalized.
- Launch: after a failed registry write the printed URL carries `?project=<id>`; a foreign `version` with control characters, a newline or a non-semver value is not printed and gives no older warning.
- Server: `DELETE` of an unregistered own Project is 409 with the message; an unknown id is 404; a `DELETE` that waits for a held lock does not stop `/api/info` from answering in the meantime; the guard of ADR 0017 still refuses a bad Origin, Host or token on that route.
- Verify with `npm test`, `npm run check` and `npm run test:browser`.

## Out of Scope

- A standalone `--port` server reading the registry.
- Card button names and a per-row Delete all.
- Older Specs that mention `/api/runs`.
- Any change to the page's behavior or layout.

## Further Notes

The findings come from the three Checks of PR #482 (Run `2026-11-03-one-dashboard-for-every-project`). The user said to continue with the left open points; every design question above was settled in Define without further questions.

Documents: `docs/specs/multi-project-dashboard.md`, `docs/dashboard.md`, `docs/development.md`, `docs/adr/0033-one-dashboard-serves-every-registered-project.md`, `GLOSSARY.md` (the Dashboard and Run detail entries), `src/project-registry.js`, `src/dashboard-launch.js`, `src/dashboard-projects.js`, `src/dashboard-handlers.js`, `src/run-folder.js`, `bin/tds-factory.js` (command line help of `dashboard`, unchanged unless the Sweep shows otherwise), and a `changelog.d/` fragment.

This is cut into three Tickets:

1. **Registry hardening**: lock token and atomic takeover, file modes and `wx` staging, 12-character id with collision handling, `join` and `mainCheckout` changes, async removal in the registry. Blocked by none.
2. **Launch and server**: the URL after a failed write, the version check, the own-Project 409 and the non-blocking `hub.remove` and DELETE. Blocked by Ticket 1.
3. **Documentation**: wording, route table, module sentence, ADR 0033 note, guide text and changelog fragment. Blocked by Tickets 1 and 2.
