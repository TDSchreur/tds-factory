## Problem Statement

A user who works on several repositories at once starts one Dashboard per repository, each on its own port, and keeps one browser tab per Dashboard. Seeing what needs attention means switching tabs, and a notification from one Dashboard says nothing about the others.

## Solution

One Dashboard serves every Project in a per-user Project registry. The Dashboard has a Project row per Project under shared Stage columns, so Runs of different Projects never mix, and the user can collapse a Project row they are not interested in. `tds-factory dashboard` in any repository registers that repository and opens the one Dashboard. See [ADR 0033](../adr/0033-one-dashboard-serves-every-registered-project.md).

## User Stories

1. As a Factory user with several repositories, I want one Dashboard for all of them, so that I need one tab instead of one per repository.
2. As a Factory user, I want each repository to register itself when a Run starts or when I open the Dashboard there, so that I never maintain a list by hand.
3. As a Factory user, I want a Run start to succeed even when the registry cannot be written, so that a read-only home folder never blocks work.
4. As a Factory user, I want a Project row per Project under shared Stage columns, so that Runs of different Projects never collide.
5. As a Factory user, I want to collapse a Project row to one line that still shows its Runs per Stage and a waiting badge, so that I free screen space and still see that something needs me.
6. As a Factory user, I want a collapsed Project row to stay collapsed after a reload and after a Run starts waiting, so that the page does not move under me.
7. As a Factory user, I want a stable alphabetical Project row order, so that Project rows do not jump when a Run starts waiting.
8. As a Factory user, I want `tds-factory dashboard` in a repository to put that Project's Project row first and expanded, so that I land where I am working.
9. As a Factory user, I want notifications for every Project, naming the Project, so that I notice a Run that needs me in any repository.
10. As a Factory user, I want PR status for GitHub and Azure DevOps Projects side by side, so that mixed repositories work.
11. As a Factory user, I want a Project whose folder is gone to show as missing and removable, so that an unmounted drive loses nothing and I can still clean up.
12. As a Factory user, I want a warning when the running Dashboard is an older Factory version than my CLI, so that I know to restart it without anything being killed.
13. As a Factory user on a narrow screen, I want the one-Stage navigation to apply to every Project row, so that the compact view still works.
14. As a keyboard and screen reader user, I want each Project row to be a labelled region with a real toggle button, so that I can move through and collapse Project rows.

## Implementation Decisions

- Glossary terms are Project, Project registry and Project row; the Dashboard definition is updated.
- The Project registry is `projects.json` in the user's Factory config folder (`XDG_CONFIG_HOME` on Linux, the platform default elsewhere), written atomically (temporary file and rename). It holds main checkout paths only. An unreadable or corrupt file is treated as empty with a warning and is not overwritten silently.
- A Project joins the registry from a Run start and from `tds-factory dashboard`, always as the main checkout, also when started inside a Run worktree. A failed write is a warning, never an error.
- A small module owns the registry and the state file, so the CLI and the server go through one seam like the Run store.
- The server listens on 4300 and falls back to a free port. It writes `dashboard.json` (pid, port, Factory version) next to the registry. A later `dashboard` call reads it and trusts it only after `/api/info` answers; a stale file is ignored and replaced. When two calls start at the same time, the one that loses the bind probes `/api/info` on 4300 and reuses the winner.
- The first `dashboard` runs the server in the foreground; later calls register their repository, print the URL with `?project=<id>` and exit. An older running Factory version gets a warning naming both versions and is never stopped.
- An explicit `--port` starts a standalone server that neither reads nor writes the state file.
- The server keeps one set of services per Project (Run store, main Run store, in-flight set, PR views, PR provider) behind the registry. Routes become `/api/projects/<id>/runs/<runId>` and the file route is scoped the same way. The Project id is a short hash of the main checkout path. A request never carries a path.
- The write guard of ADR 0017 is unchanged. One Session token per server process. The only new write is removing a Project by an id the registry holds.
- `/api/views` returns every Project's Runs, tagged with the Project. The page polls at the existing interval. PR status stays lazy, per PR link, only for visible cards.
- The page shows a Project row per Project under one sticky row of Stage headers. A Project row header has the toggle button (`aria-expanded`), the Project name (with the parent folder when two names are equal), and when collapsed the Runs per Stage and a waiting badge. A Project row is a labelled region with a heading.
- The collapsed state is kept per Project id in `localStorage`. A new waiting Run does not expand a Project row. Opening a Run from a notification or link expands its Project row.
- Project rows are in stable alphabetical order, except the `?project=<id>` Project row, which comes first and expanded. Cards inside a Project row keep the waiting-first order.
- "Needs you", the older-Runs toggle and Done-card expansion stay global; Done-card expansion is keyed by Project and Run id. "Needs you" never expands a collapsed Project row.
- Compact view (up to 1024 CSS pixels): the selected Stage applies to every Project row, Project rows stack and collapse, and the navigation counts and waiting markers sum over all Projects.
- A Project with no Runs is a collapsed Project row saying "No Runs". Missing Projects are grouped in one summary row with a warning and per-Project Remove actions.
- The Run detail drawer stays single and names the Project; a Run is always shown with its Project.
- Notifications cover every Project and name the Project.
- Update `docs/dashboard.md`, the README, the Dashboard help text and `docs/usage.md`, and add a changelog fragment.

## Testing Decisions

- Test observable behavior at the existing seams: the registry module on temporary folders, the Dashboard HTTP seam and the browser seam. Do not test private helpers or markup details.
- Registry tests: join, remove, atomic write, corrupt file treated as empty, failed write is a warning, worktree registers the main checkout.
- Server tests: two Projects with the same Run id stay apart, a write reaches only a registered Project, the ADR 0017 guard still refuses a bad Origin, Host or token, remove works by id only, state file reuse, stale state file, older version warning, explicit `--port` stays standalone.
- Browser tests: Project rows under shared Stage headers, collapse and persistence, no auto-expand on a new waiting Run, `?project=` order, missing and empty Project rows, compact view, keyboard operation of the toggle. Browser test names follow the repository's rule for names.

- Verify with `npm test`, `npm run check`, `npm run test:browser` and `npm run test:package`.

## Out of Scope

- A detached background Dashboard and a `stop` command.
- Adding a Project from the page, scanning folders for Projects, or manual Project row ordering.
- Starting or advancing a Run from the Dashboard.
- Remote or multi-user access; the server stays on 127.0.0.1.
- Changing Run records, PR providers or the Stage columns.

## Update 2026-11-03 (follow-up Spec)

Follow-up Spec [multi-project-dashboard-follow-ups.md](multi-project-dashboard-follow-ups.md) keeps active Projects in normal rows and groups missing Projects in one summary row with bulk cleanup (`DELETE /api/projects/missing`).

## Further Notes

Decided in a grilling session with the user. This is a big change cut into three vertical Tickets:

1. **Project registry and CLI**: the registry and state file, registration from Run start and `dashboard`, the single fixed port with reuse and the version warning, and `dashboard` printing `?project=`. Blocked by none.
2. **Multi-Project server**: Project-scoped routes and services, the aggregated `/api/views`, Project remove, and the guard tests. Blocked by Ticket 1.
3. **Project rows in the page**: Project rows, collapse, order, missing and empty Project rows, compact view, notifications and the Run detail change. Blocked by Ticket 2.

The ADR is [0033](../adr/0033-one-dashboard-serves-every-registered-project.md).
