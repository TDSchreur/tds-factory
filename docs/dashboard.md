# The Dashboard

`tds-factory dashboard` serves the `.factory/` folder of the main checkout of the current repository (from any subfolder or linked worktree) on 127.0.0.1. Delete is available for individual Runs in every column. Stop the Run's agent before deleting an unfinished Run. Deletion removes the Run history and its Factory-created worktree, preserving its branch and linked Tickets, PRs and Specs. Adopted worktrees are left alone. If the worktree has uncommitted changes, including untracked files or changed submodules, a separate confirmation offers to permanently discard them and remove the worktree. Cancelling preserves the Run. Git or storage failures also preserve the Run and show the cause. Delete all is limited to Done Runs and asks separately about each dirty worktree.

Without `--port`, each repository gets its own port (4300 to 4999, derived from the path of its main checkout), so Dashboards for several repositories run side by side and keep their URL across restarts. If that port is busy, the Dashboard takes a free one. `--port` uses exactly the port you give. It prints the URL when it starts.

The header shows the serving Factory installation's version beside the logo, including when there are no Runs. This is the same version printed by that installation's `tds-factory --version`.

At widths up to 1024 CSS pixels, the Dashboard shows one Stage at a time. Use the Stage buttons to switch columns; each button shows the number of visible Runs and flags those waiting for you. The first view favors a waiting Run's Stage, then the first nonempty Stage. Your selection stays in place while the Dashboard refreshes or you change the older-Run filter. Wider screens show all six columns together.

Selecting a Run opens its detail across the screen at compact widths. Use **Back to stages** or Escape to return to the Run's card in its Stage. The Dashboard remains beside the detail on wider screens, where you can select another Run without closing it.

Each card carries a Fast or Full chip for its track (a Run without a track is Full), and Run detail shows it too, with Stage time, Reworks and first-pass clean rate using the same calculations as `tds-factory run stats --id ID`. Time includes waiting and repeated visits; an active visit is labeled ongoing. Old or missing observations show `no data`. Tokens and cost are `not tracked` for current Agent targets. See [Run metrics in the usage guide](usage.md#run-metrics) for the rate and totals.

The page is built with Preact and htm, committed in `dashboard/vendor/` (see `dashboard/vendor/README.md` for versions and how to update them) and loaded as ES modules, so there is no build step. See `docs/adr/0003-preact-htm-dashboard.md`.

| Route | Returns |
|---|---|
| `/` | The Dashboard page, with a card per Run in a column per Stage. Runs waiting on you are flagged. Cards show the track, and Check cards a chip per verdict: Standards, Spec, Security and Infrastructure (Spec may be skipped on the Fast track). Cards carry the [actions](#actions). |
| `/style.css`, `/favicon.svg`, `/app.js`, `/components.js`, `/model.js`, `/markdown.js`, `/vendor/preact.js`, `/vendor/hooks.js`, `/vendor/htm.js` | The Dashboard's stylesheet, icon, ES modules and vendored libraries, from the `dashboard/` folder. Only these names are served. |
| `/api/views` | Run records interpreted for the Dashboard. |
| `/api/info` | The project folder the Dashboard serves, the session token for write routes and, when available, the serving Factory package version. |
| `/api/runs` | A JSON list of Run records. A record that cannot be read comes back with `unreadable: true`. |
| `/files/<run-id>/<name>.md` | A Markdown file from a Run folder. |
| `DELETE /api/runs/<run-id>` | Deletes a Run. Dirty worktrees return HTTP 409 with `X-Factory-Error: dirty-worktree`. A separately confirmed `?discardChanges=true` discards changes. A write route: see [Write routes](#write-routes). |
| `GET /api/runs/<run-id>/merge-checks` | The GitHub checks of the Run's pull request. |
| `POST /api/runs/<run-id>/merge` | Squash-merges the Run's pull request. A write route. |
| `POST /api/runs/<run-id>/sync` | Runs `tds-factory run sync` for the Run: rebases its branch onto the default branch of `origin`. A refusal (uncommitted changes, a conflict, a Run outside Build and Check) is HTTP 409 with the message. A write route. |
| `POST /api/runs/<run-id>/clean` | Runs `tds-factory run clean` for the Run from the main checkout. A Run that is kept (PR not merged, uncommitted changes, extra commits) is HTTP 409 with the reason. A write route. |
| `POST /api/runs/<run-id>/accept` | Accepts a Check that is not clean for the Run's current head. Only for a Run in Check that waits on you, with `?updated=` naming the Run record time the page showed (a changed Run is refused), and refused with HTTP 409 when the Check is already clean or accepted. A write route. |

## Actions

Cards carry buttons for the Dashboard actions. Each asks for confirmation, then shows the result or the reason it was refused.

- **Sync** appears on running Runs in Build and Check (a Run waiting on you, or paused, cannot change until it runs again). It rebases the Run branch onto the current default branch of `origin`. If the code or the base changes, the Evidence is cleared.
- **Accept Check** appears on a Check that waits on you. The confirmation lists the four verdicts. It records that you continue to Finish with a Check that is not clean, for the current code only; a new commit voids it. The Run is released from waiting. Then tell the agent in its chat that you accepted: it finds the decision recorded for the current head and moves on to Finish.
- **Clean up** appears on a Done Run whose pull request is merged. It removes the Run worktree and branch and keeps the Run record.

Starting a Run stays in the agent: the Dashboard cannot start, resume, rework or complete a Run.

### Needs you notification

When a Run starts waiting on you while the Dashboard is open, the browser shows a notification, `Needs you: <title>`, with the reason. Runs that already wait when you open the page only count in the tab title. Press **Notify me** in the header to let the browser ask for permission; the button disappears once you have answered. Without notifications, the `(N)` in the tab title still shows how many Runs wait on you.

## Write routes

Every route that changes something (`DELETE` and `POST`) passes one guard before it does anything, and a request that fails it gets HTTP 403:

- the `Host` header is `127.0.0.1:<port>` or `localhost:<port>` (this applies to every route);
- the `Origin` header equals `http://<Host>`, so only this Dashboard page can write;
- the `X-Factory-Token` header holds the session token. The server makes the token when it starts and the page reads it from `/api/info`. It changes on every start, so reload an open page after restarting the Dashboard.

The server sends no CORS headers and answers no preflight. See [ADR 0017](adr/0017-dashboard-write-routes-need-origin-host-and-a-session-token.md).

## Merging from the Dashboard

The **Merge** button asks the server to merge the Run's pull request, and the server checks first:

```mermaid
flowchart TB
    click(["Merge"]) --> done{"Run is done and has a PR link?"}
    done -->|no| refuse["refused (409)"]
    done -->|yes| clean{"Check clean or accepted, for the current head?"}
    clean -->|no| refuse
    clean -->|yes| repo{"PR belongs to the Run repository?"}
    repo -->|no| refuse
    repo -->|yes| open{"PR is open and its head equals the Run head?"}
    open -->|no| refuse
    open -->|yes| merge["Squash-merge with gh"]
```

If GitHub cannot be reached, returns no usable PR head, or `gh` cannot merge, the server answers 502 and merges nothing. An unknown Run gets 404, and a write without the page's Origin and session token gets 403 (see [Write routes](#write-routes)).

For how to read the cards, see the [usage guide](usage.md#5-follow-runs-on-the-dashboard).

The browser tab is titled `<project folder> · TDS Factory`, with `(N) ` in front while N Runs wait on you, so several Dashboards are easy to tell apart. The Dashboard serves `/favicon.svg` as the tab icon.
