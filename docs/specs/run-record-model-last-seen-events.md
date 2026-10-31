# Run record: requested model and effort, last seen and an event log

[GitHub issue #275](https://github.com/TDSchreur/tds-factory/issues/275), milestone v0.6.0 (foundations), needed by the Dashboard work in milestone 3. The Run record has `agent` but no model, no effort, no sign of life and no history, so the Dashboard cannot say which model runs a job, how far it is, or whether the agent went quiet. See [ADR 0021](../adr/0021-run-record-model-last-seen-and-event-log.md).

## Behavior

- New optional Run record fields `requested_model`, `requested_effort` and `observed_model`, strings. An agent reports them once through `run update`. Every change of Stage (a transition, a Rework or a Follow-up) clears the three fields and then sets `requested_model` from the frozen `project_config.models` entry for the new Stage when there is one, so a model from an earlier Stage never stays on a later one. A requested model is never shown as a confirmed one: only `observed_model` is agent-reported as seen.
- `last_seen`, an ISO timestamp, is refreshed by every write of the Run record: `changeRun` sets it for update, transition, verdict, verify, sync, rework, follow-up and the rest, and `run start` and `run repair --apply`, which write on their own, set it themselves.
- `events.jsonl` in the Run folder is an append-only log, one JSON object per line with `at` and `type`: `stage` (from, to), `ticket-done`, `verify-start`, `verify` (finish, with `duration_ms`, `exit_code`, `head`, `fast`), `waiting` (reason), `released`, `status` (other status changes) and `rework`. Stage, Ticket, waiting, release, status and Rework events are derived by the Run store from the change it writes, so no operation can forget one. A failed append never fails the operation, because the Run record stays the source of truth.
- Reading the log skips lines that cannot be parsed and counts them, refuses a symlinked log, and reads at most the last 256 KiB.
- `/api/views` returns `model` (`requested`, `effort`, `observed`, each empty when unknown), `lastSeen`, `events` (the last 50) and `eventsDamaged` (the count of unreadable lines). No Dashboard UI changes.
- Old Runs without the fields and without a log load; unknown values are empty, not zero or guessed.
- The factory Skill tells agents to report model and effort once and to update `activity` more often; its field table lists the new fields.

## Test seams

The Run store (`openRunStore`) with real Runs for fields, validation, `last_seen`, derived and explicit events and old records; the log reader with a damaged file and a symlink; `interpretRun` and `/api/views` for the new data; the Skill text pins.

## Out of scope

Dashboard UI; changing Run metrics or `run stats`; token or cost data; any other new Run record field.
