# The Dashboard

`tds-factory dashboard` serves the `.factory/` folder of the main checkout of the current repository (from any subfolder or linked worktree) on 127.0.0.1 and can delete completed or abandoned Runs after confirmation. Deleting a Run also removes the Run worktree that `run start` created (not an adopted one) after checking that nothing in it would be lost: a clean worktree is removed even when it has initialised submodules, and if it has uncommitted changes (including untracked files or a changed submodule) or git cannot remove it, the removal is refused, the message names the cause and the Run stays. Branches are never deleted. Without `--port`, each repository gets its own port (4300 to 4999, derived from the path of its main checkout), so Dashboards for several repositories run side by side and keep their URL across restarts. If that port is busy, the Dashboard takes a free one. `--port` uses exactly the port you give. It prints the URL when it starts.

The page is built with Preact and htm, committed in `dashboard/vendor/` (see `dashboard/vendor/README.md` for versions and how to update them) and loaded as ES modules, so there is no build step. See `docs/adr/0003-preact-htm-dashboard.md`.

| Route | Returns |
|---|---|
| `/` | The Dashboard page, with a card per Run in a column per Stage. Runs waiting on you are flagged. Check cards show a chip per verdict: Standards, Spec, Security and Infrastructure. |
| `/style.css`, `/app.js`, `/components.js`, `/model.js`, `/markdown.js`, `/vendor/preact.js`, `/vendor/hooks.js`, `/vendor/htm.js` | The Dashboard's stylesheet, ES modules and vendored libraries, from the `dashboard/` folder. Only these names are served. |
| `/api/views` | Run records interpreted for the Dashboard. |
| `/api/info` | The project folder the Dashboard serves. |
| `/api/runs` | A JSON list of Run records. A record that cannot be read comes back with `unreadable: true`. |
| `/files/<run-id>/<name>.md` | A Markdown file from a Run folder. |
| `DELETE /api/runs/<run-id>` | Deletes a Run, after the same checks as the Delete button. Same-origin requests only. |
| `GET /api/runs/<run-id>/merge-checks` | The GitHub checks of the Run's pull request. |
| `POST /api/runs/<run-id>/merge` | Squash-merges the Run's pull request. Same-origin requests only. |

## Merging from the Dashboard

The **Merge** button asks the server to merge the Run's pull request, and the server checks first:

```mermaid
flowchart TB
    click(["Merge"]) --> done{"Run is done and has a PR link?"}
    done -->|no| refuse["409: refused"]
    done -->|yes| clean{"Check clean or accepted, for the current head?"}
    clean -->|no| refuse
    clean -->|yes| repo{"PR belongs to the Run repository?"}
    repo -->|no| refuse
    repo -->|yes| open{"PR is open and its head equals the Run head?"}
    open -->|no| refuse
    open -->|yes| merge["Squash-merge with gh"]
```

If GitHub cannot be reached, the server answers 502 and merges nothing.

For how to read the cards, see the [usage guide](usage.md#5-follow-runs-on-the-dashboard).
