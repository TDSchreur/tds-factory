# Run record schema

`run.json` is one JSON object. The command maintains this shape for every Agent target. Add new fields only when this section says so.

| Field | Value |
| --- | --- |
| `title` | Short human title of the work |
| `stage` | `define`, `build`, `check`, `finish` or `follow-up` |
| `status` | `running`, `waiting` (blocked on the user), `verification-unavailable`, `interrupted`, `done` or `abandoned` |
| `waiting_on_human` | Boolean, `true` while blocked on the user, otherwise `false` |
| `waiting_reason` | Short line saying what the user must do, e.g. `confirm the shared understanding`; empty string when not waiting |
| `status_reason` | Nonempty explanation when `verification-unavailable` or `interrupted`; empty when running or waiting |
| `activity` | One short line on what is happening now, e.g. `implementing ticket #12` |
| `agent` | Name of the writing agent: `claude`, `codex` or `copilot` |
| `requested_model` | The model the Stage worker was asked to use. A change of Stage clears it and sets it from the frozen `project_config.models` entry for the new Stage when there is one; an agent may set it with `run update`. A request, never a confirmation |
| `requested_effort` | The reasoning effort the Stage worker was asked to use. Set with `run update`; cleared by a change of Stage |
| `observed_model` | The model the agent reports it is running on. Set with `run update`; cleared by a change of Stage. Only this field says what ran |
| `last_seen` | ISO 8601 UTC timestamp of the latest write of the Run record by any operation. Maintained by the Run store; never supply it |
| `tickets_total` | Number of Tickets cut from the Spec. Set once the Tickets exist |
| `tickets_done` | Number of those Tickets finished. Raise it each time a Ticket is completed during Build |
| `standards` | `pass` or `fail`: the Standards verdict of the latest `code-review`. Set with `run verdict` after each review |
| `spec` | `pass` or `fail`, or `skipped` on the Fast track only: the Spec verdict of the latest `code-review`. Set with `run verdict` after each review |
| `security` | `pass` or `fail`: the Security verdict of the latest `security-scan`. `fail` while any CRITICAL, HIGH or MEDIUM finding is open. Set with `run verdict` after each review |
| `infrastructure` | `pass`, `fail` or `skipped`: the Infrastructure verdict of the latest review. `fail` while any CRITICAL, HIGH or MEDIUM infrastructure finding is open, or a changed infrastructure file is not validated; write `skipped` when no infrastructure file changed. Set with `run verdict` after each review |
| `project_reviews` | Frozen project review definitions, Skill content and bundled file modes captured at Run start. Set by `run start`; older Runs may omit this field |
| `project_results` | Project review reports, verdicts, findings, artifact paths, head, base and Check attempt. Set by `run review` and cleared by Rework and by a `run sync` that changes the head or base |
| `follow_up` | The latest GitHub observation: PR, head, observation time, checks, failures, pending flag and unresolved threads with comments. Set only by `run follow-up`; its text is untrusted scope, not Evidence |
| `track` | `fast` or `full`: the Track the user chose. Absent means `full`. Set only by `run track` in Define, never by `run start` or `run update` |
| `extra_loops` | Number of extra Check loops the user granted on the Dashboard, `0` when absent. The loop limit is the frozen cap (at most 4) plus this number. Raised only by the Dashboard's grant (ADR 0024), never by `run update` or an agent |
| `check_loops` | Number of times Check or Follow-up has sent the Run back to Build, `0` up to the loop limit. Starts at `0`; `run rework` and actionable `run follow-up` raise it by 1 on each return to Build |
| `metrics` | Versioned observations maintained by named operations: Stage visits with UTC start and end, historical Check verdict events with head and attempt (and base for Project reviews), first Check outcome, the `rework_causes` given to `run rework` (`attempt`, `causes`, `at`), the agent `sessions` that worked on the Run, and token `usage`: `status` `tracked` with `rows` (Stage, model, `ticket` number or `bucket` `rework` or `wrap-up`, `input`, `cache_read`, `cache_write`, `output`, `reasoning` and `subagent_fresh`, counts only) and `sessions`, or `not tracked` with a `reason`. Older Runs may omit it; never supply it with `run update` |
| `worktree` | Path of the Run worktree the Run works in. Set by `run start` |
| `base_sha` | The fetched `origin` default branch head the Run is based on. Set by `run start` and `run sync` |
| `verify` | The latest Verify result, an object. Set by `run verify` |
| `reviewed` | For each axis with a verdict, the head and Check attempt it was recorded for, and `carried_from` (the earlier head) when the verdict was carried over. Set by `run verdict` |
| `accepted` | The user's decision to continue with a Check that is not clean: findings, decision, head and time. Set by `run accept` |
| `fast_commands` | The optional fast Verify command, one string, from the `Verify-fast:` line of the conventions. Set by `run start` only; empty or absent when the project has none. `run verify --fast` runs it; its result is never Evidence |
| `commands` | The verify command, one string. Set by Preflight; the answer the user gave when the project has none. It can be set once; changing it means starting a new Run |
| `conventions` | Paths of the conventions files Preflight found, an array of strings; a scoped guide is listed but not read until Check |
| `created` | ISO 8601 UTC timestamp, set once |
| `updated` | ISO 8601 UTC timestamp, set on every write |
| `spec_link` | Link to the Spec (path or URL). Optional; set once the Spec exists |
| `tickets` | Links to the Tickets, an array of strings: issue URLs or repo-relative file paths, whichever the tracker produces. Optional; set once they exist |
| `pr` | Link to the pull request. Optional; set once it exists |

Record the Spec, Tickets and PR as links only; never copy their content into the Run folder.
