# Dashboard progress and event timeline

## Problem Statement

The Run record already carries the model, the last sign of life and an event log ([ADR 0021](../adr/0021-run-record-model-last-seen-and-event-log.md)), and `/api/views` returns them, but the Dashboard shows none of it. A user cannot see how far a Run is, which model works on it, or whether the agent went quiet. This is the first item of the Dashboard work in milestone v0.6.0.

## Solution

Show progress on the Dashboard from data that already exists. Each card gets a Ticket progress bar, the activity line, the model and effort labelled as requested, and a "last seen" that turns into a warning when the agent has been quiet for 10 minutes. The Run detail gets an event timeline with relative times and a note when the event log is damaged. No write route and no Run record change.

## User Stories

1. As a user, I want a progress bar on a card with its finished and total Tickets, so that I see how far Build is.
2. As a user, I want the current activity line on every card, so that I see what the agent does now.
3. As a user, I want the card to show the requested model and effort, labelled "requested", so that I never take a request for a confirmed model.
4. As a user, I want the label to say "observed" only when the agent reported `observed_model`, so that a confirmed model is recognisable.
5. As a user, I want "last seen N min ago" on a running card, so that I see the agent is alive.
6. As a user, I want that text to become a warning after 10 minutes without a sign of life, so that I notice a stuck agent. A Run that is done, abandoned or waiting on me is never warned.
7. As a user, I want an event timeline in the Run detail (Stage changes, Ticket done, Verify start and finish with duration, waiting and release, Rework), newest last, with relative times, so that I see what happened.
8. As a user, I want a clear note when some event log lines could not be read, so that I know the timeline is incomplete.
9. As a user, I want Runs without these fields (older records, unreadable records) to render without errors, with no invented values.

## Implementation Decisions

- Pure helpers in `dashboard/model.js`: `progressOf(run)`, `modelOf(run)`, `lastSeenOf(run, now)` and `timelineOf(run)`. They are lenient: any field may be missing or of the wrong type.
- Quiet threshold: `QUIET_MS = 10 * 60 * 1000`, the same length as the existing `STALE_MS`. Last seen comes from `lastSeen`, falling back to `updated`. It is a warning only while the Run is `running`. The warning is text ("quiet for N min") and a class, never colour alone.
- Progress bar: a native `<progress>`-like element with `role="progressbar"`, `aria-valuenow` and `aria-valuemax`; shown only when `ticketsTotal` is a positive number.
- Model: "Model (requested): X, effort Y" when `observed` is empty; "Model (observed): Z" with the requested one in a tooltip when `observed` is set. Nothing when all are empty.
- Timeline events map to text: `stage` "Moved from A to B", `ticket-done` "Ticket 2 of 3 done", `verify-start` "Verify started" (fast or full), `verify` "Verify passed/failed in 12s" (fast or full), `waiting` "Waiting: reason", `released` "Released", `rework` "Rework, loop N", `status` "Status: s". An unknown type shows its type name.
- No change to `src/` or to the Run record. The server already returns the fields.
- `docs/dashboard.md` describes the card and the timeline; a changelog fragment is added.

## Testing Decisions

- Unit tests for the four helpers, with missing, wrong-typed and old-record inputs, in `test/dashboard-progress.test.js` (also imported by browser-free test runs).
- Browser tests with the stub server in `test/browser.js`: the card shows the bar, the activity, the requested and observed labels, the last-seen text and its warning; the drawer shows the timeline and the damaged note; an old Run renders without them and without errors.

## Out of Scope

New write routes, Run record changes, waiting-on-you treatment, PR status, the Fluent 2 redesign.
