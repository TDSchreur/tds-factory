# Dashboard: waiting on you

## Problem Statement

A Run that waits on the user is only a red card. It is easy to miss, does not say how long it has waited, and is mixed in with the other Runs of its Stage. This is the second item of the Dashboard work in milestone v0.6.0.

## Solution

Make a waiting Run unmistakable and easy to reach. The card gets a "Needs you" banner with a symbol and text (not colour alone), the waiting age and the reason. A "Needs you" button in the header filters every Stage to the waiting Runs. Inside each Stage, waiting Runs come first. The tab title count and the browser notification keep working and use the same definition of waiting: the `waiting` flag that `interpretRun` computes from the Run record.

## User Stories

1. As a user, I want a waiting card to carry a "⏸ Needs you" banner with its reason, so that I see it without relying on colour.
2. As a user, I want the banner to say how long the Run has waited ("waiting 12 min"), so that I know which one is oldest.
3. As a user, I want no age when the event log cannot tell me (an older Run, a damaged or truncated log), rather than a guess.
4. As a user, I want a "Needs you (N)" button in the header that shows only waiting Runs in every Stage, so that I can handle them in one pass.
5. As a user, I want the button to say it is pressed, and to show an empty message in a Stage with no waiting Runs, so that I always know the filter is on.
6. As a user, I want waiting Runs first in each Stage column, the longest waiting first, so that the most urgent one is on top.
7. As a user, I want the tab title count and the notification to keep working, from the same definition of waiting as the banner, the filter and the sort.
8. As a user, I want the Run detail to show the same banner, so that the card and the detail agree.

## Implementation Decisions

- Pure helpers in `dashboard/model.js`: `waitingSince(run)` (the time of the latest `waiting` event with no later `released` or `status` event, as milliseconds, or null), `waitAgeOf(run, now)` (`{ text: "waiting 12 min" }` or null; null when the Run does not wait) and `sortWaitingFirst(runs)` (a stable partition: waiting Runs first, ordered by the start of their wait with known starts before unknown ones, then the rest in their existing order). The age uses the existing `ago` steps without "ago": "less than a minute", "N min", "N h", "N d".
- Waiting is `run.waiting` everywhere; no helper recomputes it from `status`.
- The banner replaces the plain "Needs you" reason line for waiting Runs on the card and in the detail; paused states ("Verification unavailable", "Agent interrupted") keep their lines and get no age.
- The filter is page state in `app.js`, not saved, and applies to the Stage lists and the Stage button counts. The Stage button for a Stage without waiting Runs stays visible. Done-column Runs never wait, so the Done column is empty under the filter. A waiting Run is never hidden as "older", so the filter hides nothing it should show.
- The filter and the sort do not change the selected Run, the default Stage or the open detail.
- No change to `src/`, the Run record or routes. `docs/dashboard.md` and a changelog fragment are updated.

## Testing Decisions

- Unit tests for `waitingSince`, `waitAgeOf` and `sortWaitingFirst`, including missing, wrong-typed and truncated logs, in `test/dashboard-waiting.test.js`.
- Browser tests with the stub server: the banner text and symbol, the age, no age without events, the sort order, the filter button (pressed state, counts, empty message), and the tab title count and notification unchanged with the filter on.

## Out of Scope

New write routes, Run record changes, notifications while the Dashboard is closed, saving the filter.
