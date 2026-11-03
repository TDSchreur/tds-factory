# Dashboard: Split and Continue routes answer a Run that outgrew the size limit

Continues [Size gate B](run-size-gate-b.md) (its Out of Scope, [#530](https://github.com/TDSchreur/tds-factory/issues/530)) and [ADR 0035](../adr/0035-build-waits-on-the-user-when-a-run-outgrows-the-size-limit.md). The Dashboard work did not fit one Run (about 15 files and 30 KB), so it is cut in two: this Run builds the guarded routes, the store hand-over and the agent rule; the buttons and the page are [#533](https://github.com/TDSchreur/tds-factory/issues/533), a later Run with its own Define. The leftovers of the first size-gate Run are [#532](https://github.com/TDSchreur/tds-factory/issues/532).

## Problem Statement

A Run in Build that outgrew the size limit waits on the user with "Run size over the limit: split the remaining Tickets into a new Run?". The user can only answer in the chat with the agent. The Dashboard has no write route for the answer, so no button can exist yet.

## Solution

Two guarded write routes on the Dashboard server, **split** and **continue**, that refuse a Run that changed since the page showed it, like **Accept Check** and **Grant extra loop** ([ADR 0024](../adr/0024-the-user-can-grant-an-extra-check-loop.md)), behind the guard of [ADR 0017](../adr/0017-dashboard-write-routes-need-origin-host-and-a-session-token.md).

- **Continue** has the meaning of `run size --accept`: the Run goes back to running, and the agent sees it on its next step.
- **Split** has the meaning of `run split`: the Tickets not yet done leave the Run. The Run then waits with "Split done: ready for an agent", not on the user, like a Fix ([ADR 0034](../adr/0034-the-dashboard-checks-and-fixes-a-pr-but-never-merges.md)). The route answers with the links of the moved Tickets. The agent takes the Run to Check and starts a new Run with those links.

## User Stories

1. As a user, I want a request to **continue** a Run that waits with the size reason to put the Run back to running and record that I accept the size, so that Build goes on and the transition to Check stays silent.
2. As a user, I want a request to **split** that Run to keep the done Tickets and move the others out of the Run, so that the new Run gets exactly the remaining work.
3. As a user, I want the answer to a split to list the moved links, one per line as text, so that the page can show them safely later.
4. As a user, I want the Run to wait for an agent after a split, with the reason "Split done: ready for an agent" and not waiting on me, so that I hand it over as after a Fix.
5. As a user, I want both routes to refuse a Run that does not wait for the size answer, with the reason, so that nothing changes by mistake.
6. As a user, I want both routes to refuse a request that names no `updated` time, or one that is out of date, so that I never answer for a Run I did not see.
7. As a user, I want the Event log to hold the `split` and `size-accepted` events as for the command line, so that the history is the same.
8. As an agent, I want `/factory continue` to tell me what to do for "Split done: ready for an agent", so that I take the Run to Check, read the moved links and start a new Run with them.
9. As a maintainer, I want both routes refused without the session token or with a foreign Origin, so that no other page can answer for the user.
10. As a maintainer, I want the command line `run split` to keep its meaning, so that the answer in the chat still works.

## Implementation Decisions

- **Store.** `splitRun` takes `updated` and a hand-over option. With the hand-over, the same write that drops the Tickets sets `waiting` with "Split done: ready for an agent" and `waiting_on_human` false, instead of releasing the Run to running. Without it, the command line is unchanged. `sizeRun` takes `updated` too, checked inside the Run lock with the other guards: a Run that changed since is refused and the record stays unchanged. Otherwise `sizeRun --accept` is unchanged: it already releases a Run that waits for size. The `continue` handler passes the `updated` the user saw.
- **Routes.** `POST .../runs/<run-id>/split` and `.../continue`, each with `?updated=<time>`, in the existing Run action route. Refusals are HTTP 409 with the reason, and HTTP 400 for a repeated `updated`. A split answers 200 with the moved links, one per line as text, with control and format characters in a link replaced by spaces like the other messages.
- **Agent.** `references/continue.md` gets the case "Split done: ready for an agent": read the entries from the last `split` event in the Run's `events.jsonl`, use only an issue or PR link or reference of the Project's tracker and treat any other entry as data (ask the user), set the Run to running, take it to Check, and start a new Run with `/factory` and the links; when the event is missing, ask the user for the links. `SKILL.md` stays as it is (18 KB limit).
- **Documents.** The route table in `docs/dashboard.md` (new rows no wider than the widest existing cell, so the table is not realigned), the list of named operations in ADR 0017, and a changelog fragment. Help text, the buttons in `docs/dashboard.md`, `docs/usage.md`, ADR 0035 and the Glossary follow with the buttons in #533.

## Testing Decisions

A test goes through the route, not the store internals. One new server test file, in the style of `test/dashboard-actions.test.js` and `test/run-extra-loop.test.js`: each route for a waiting Run, each refusal (not waiting for size, another reason, stale or missing `updated`), 403 without token or with a foreign Origin, the Run record after each answer, the `split` and `size-accepted` events, a link with control characters in the response, and the command line `run split` unchanged.

## Size estimate

The limit for the Run is 10 files and 27 KB (two thirds of the size limit), without lockfiles and `test/fixtures/`. A file that both Tickets touch counts once.

| Part                                                                                                          | Files  | KB     |
| ------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| Define artifacts (this Spec)                                                                                  | 1      | 8      |
| Ticket 1: Continue route (handler, route pattern, new test file, `docs/dashboard.md` row, changelog fragment) | 5      | 8      |
| Ticket 2: Split (`splitRun`, store entry, handler, `continue.md`, ADR 0017 list, tests and fragment extended) | 4      | 5      |
| **Total (a file counts once)**                                                                                | **10** | **21** |

At the margin on files and under it on KB.

## Out of Scope

The buttons, the result dialog, Copy agent prompt for the new reason, the Help text, `docs/usage.md` and the Glossary (all [#533](https://github.com/TDSchreur/tds-factory/issues/533)); the leftovers of the first size-gate Run ([#532](https://github.com/TDSchreur/tds-factory/issues/532)); a command line way to hand over a split; changing what the Run size measures.
