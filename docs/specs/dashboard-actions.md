# Dashboard actions

## Problem Statement

The Dashboard shows Runs but the user has to leave it for the terminal to sync a Run, clean up a merged one or accept a Check that is not clean, and it only tells the user that a Run waits on them through the tab title. This is [GitHub issue #249](https://github.com/TDSchreur/tds-factory/issues/249), in milestone v0.5.0. The scope stays within that issue.

## Solution

Add the first Dashboard actions: a "Needs you" browser notification, and buttons for `run sync`, `run clean` and accepting a Check that is not clean. Starting a Run stays in the agent; the Dashboard has no route that starts or advances a Run. Before any new write route ships, an ADR fixes the rules for write routes on the 127.0.0.1 server: same-origin only, Origin and Host checks, a per-session token and no CORS ([ADR 0017](../adr/0017-dashboard-write-routes-need-origin-host-and-a-session-token.md)).

## User Stories

1. As a maintainer, I want one written rule for write routes on the loopback server, so that every new route is held to the same checks.
2. As a user, I want every write route (the new ones and the existing Delete and Merge) to refuse a request without the page's own Origin and the session token, so that another web page in my browser cannot change my Runs.
3. As a user, I want a browser notification when a Run starts waiting on me, so that I notice without watching the tab.
4. As a user, I want to enable notifications with a button, so that the browser asks for permission only when I choose.
5. As a user, I want the tab title count of waiting Runs to keep working, so that I can see it without notifications.
6. As a user, I want a Sync button on Runs in Build and Check that asks first, so that I can bring a Run up to date with origin and see a conflict or refusal.
7. As a user, I want a Clean up button on a Done Run whose PR is merged that asks first, so that I can remove its worktree and branch, and see why it was kept when it was.
8. As a user, I want an Accept Check button on a Check that waits on me, showing the verdicts, so that I can continue to Finish with a Check that is not clean, for the current head only.
9. As a user, I want Accept refused for a Check that is already clean or accepted, so that the Dashboard records no decision I was not shown.

## Implementation Decisions

- `POST /api/runs/<id>/sync` runs the store's `sync`. `POST /api/runs/<id>/clean` runs `clean` from the main checkout, also when the Dashboard was started in a Run worktree; a Run that is kept answers 409 with the reason. `POST /api/runs/<id>/accept` builds the findings from the Run's unmet finish conditions, records `accept` and answers 409 unless the Run is in Check and waits on the user and the Check is not yet clean or accepted. The routes take no body.
- `accept` first sets the waiting Run to `running`, as the Factory Skill does, because a Run changes only while running; if the accept fails it sets the Run back to `waiting` with its reason.
- One guard runs before every non-GET route: Host (already global), Origin equal to the Host, and the header `X-Factory-Token` equal to a random token made at server start. The page reads the token from `/api/info`. No CORS headers are sent.
- The notification uses the browser Notification API. A Run that starts waiting while the page is open raises one notification (`Needs you: <title>`, tag = Run id); Runs already waiting at the first poll only count in the tab title. The "Notify me" button appears only while permission is still undecided.
- `docs/dashboard.md` documents the routes and the guard; `GLOSSARY.md` names the Dashboard session token; a changelog fragment is added.
- Out of scope: starting, resuming, reworking or completing a Run from the Dashboard, choosing the accepted findings text, bulk clean-up, persistent tokens.

## Testing Decisions

- Server tests drive `startDashboard` against real temporary git repositories and the CLI, as in `test/run-sync.test.js`: sync, clean (with an injected PR lookup) and accept outcomes and refusals, plus the guard on every write route (no headers, no token, wrong token, foreign Origin), no CORS headers and no preflight answer.
- Browser tests (`*-browser.test.js`) use the stub server of `test/browser.js`: each button's visibility rule, the confirmation, the request and its token, the result or refusal dialog, and the Notification behavior with a stubbed `window.Notification`.
