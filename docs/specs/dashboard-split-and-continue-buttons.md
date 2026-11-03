# Dashboard: Split and Continue buttons for a Run that outgrew the size limit

Builds on [Dashboard: Split and Continue routes](dashboard-split-and-continue.md) (PR #536), [ADR 0035](../adr/0035-build-waits-on-the-user-when-a-run-outgrows-the-size-limit.md) and [ADR 0017](../adr/0017-dashboard-write-routes-need-origin-host-and-a-session-token.md). Closes [#530](https://github.com/TDSchreur/tds-factory/issues/530) and [#533](https://github.com/TDSchreur/tds-factory/issues/533).

## Problem Statement

A Run in Build that outgrew the size limit waits on the user, and the Dashboard server can already take the answer, but the page has no button for it. The user still has to answer in the chat.

## Solution

**Split** and **Continue** buttons on the Run card and in the Run detail, next to **Copy agent prompt**, for a Run that waits for the size answer. Both ask for confirmation first. After a split, the Run waits for an agent, and **Copy agent prompt** shows for that reason too.

## User Stories

1. As a user, I want Split and Continue on a Run that waits for the size answer, so that I answer without leaving the Dashboard.
2. As a user, I want no such buttons on any other Run, so that I cannot answer a question that was not asked.
3. As a user, I want the Split confirmation to say how many Tickets are done and stay and how many move to a new Run, so that I know the effect before I confirm.
4. As a user, I want the Continue confirmation to say the size is accepted and not asked again, so that I know what I accept.
5. As a user, I want Cancel to send nothing, so that a mistaken click costs nothing.
6. As a user, I want the result of a split to list the moved Ticket links, so that I can open them.
7. As a user, I want a link that is not a safe URL shown as text, so that a hostile Ticket link does nothing.
8. As a user, I want "Nothing was left to move." when a split moved no Ticket, so that an empty answer is not mistaken for a failure.
9. As a user, I want a refusal (the Run changed meanwhile) shown with the server message and the page reloaded, so that I see the current state.
10. As a user, I want **Copy agent prompt** for "Split done: ready for an agent", so that I hand the Run to an agent as after a Fix.
11. As a user, I want Help and the docs to describe both buttons, so that I know when to use which.

## Implementation Decisions

- **Visibility.** One shared component renders both buttons on the card and in the detail. It shows only for a readable Run that is waiting, in the Build column, with the size reason. The page mirrors the size reason and the split-done reason from the Node side, with a unit test that the constants are equal, and one helper decides both the buttons and the copy button. Neither button is primary; card buttons stop propagation like the others. The aria-labels are "Split <title>" and "Continue <title>".
- **Split.** Fixed rule, no Ticket picker: done Tickets stay, the rest move. The confirmation shows the counts and says the Run then waits for an agent. It is not a danger action.
- **Continue.** Confirmation: "Accept the size and continue Build?", naming the Run. Result notice "Continued", with "The agent picks it up on its next step."
- **Requests.** Both go through the existing guarded action path with the `updated` time the page showed and the session token, and refresh the page after an answer.
- **Result dialog.** The dialog request gets an optional list of links, rendered through the existing link component, so an unsafe URL stays text. An empty body shows "Nothing was left to move." No copy button in the dialog.
- **Refusals.** A notice dialog titled "Could not split the Run" or "Could not continue the Run" with the server message, then the page reloads, as for Grant and Accept.
- **Copy agent prompt.** Also shows for the split-done reason; the prompt text stays `/factory continue <id>`.
- **Documents.** Help text, [the Dashboard guide](../dashboard.md), [usage](../usage.md), the Copy agent prompt line in the Glossary, and the existing changelog fragment `changelog.d/dashboard-split-and-continue.md` (extended, no new fragment). Sweep found no other document to change.

## Testing Decisions

Test behaviour in the browser, through the page, in the style of the extra-loop and Fix browser tests: visibility (shown for the size reason; absent for other reasons, other columns and an unreadable Run), confirmation texts and counts, Cancel sends nothing, request URL with `updated` and the token header, the Continue result, the Split link list (a `javascript:` link stays text), the empty case, refusals, and Copy agent prompt for the split-done reason. A unit test on the model checks that the page constants equal the Node ones. The server routes are already tested.

## Size estimate

Limit: 15 files and 40 KB; target at the Define margin of 10 files and 27 KB (two thirds), without lockfiles and `test/fixtures/`.

| Part                                                                                                      | Files                                                             | KB     |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| Define artifacts (this Spec)                                                                              | 1                                                                 | 5      |
| Ticket 1: Continue end to end (model, components, app, help, unit test, new browser test)                 | 6                                                                 | 11     |
| Ticket 2: Split (components, app, model test, browser tests, dashboard guide, usage, Glossary, changelog) | 4 (guide, usage, Glossary, changelog; code files already counted) | 11     |
| **Total (a file counts once)**                                                                            | **11**                                                            | **27** |

A file that both Tickets touch counts once. One file over the margin; well inside the limit.

## Out of Scope

A Ticket picker for Split; a copy button in the result dialog; changing the routes or what the Run size measures; a command line way to hand over a split; the leftovers in [#532](https://github.com/TDSchreur/tds-factory/issues/532).

## Further Notes

Documents (Sweep): `docs/specs/dashboard-split-and-continue.md`, `docs/specs/run-size-gate-b.md`, `docs/specs/dashboard-check-pr.md` (Copy agent prompt), `docs/dashboard.md`, `docs/usage.md`, `GLOSSARY.md`, `dashboard/help.js`, `skills/factory/references/continue.md` (already handles the split-done reason), `changelog.d/dashboard-split-and-continue.md`.
