# Token usage per Stage, model and Ticket

Full track. Decision record: [ADR 0026](../adr/0026-token-usage-is-read-from-the-agent-session-logs.md). Extends the [Run metrics Spec](run-metrics.md).

## Problem Statement

A user of the Factory cannot see what a Run costs in tokens. The Run record says `Tokens: not tracked`, so the user cannot tell which Stage, which model or which Ticket used the tokens, whether a cheaper model was used where it was configured, or whether a Rework was expensive. The Agent targets (Claude Code, Codex and Copilot) already write per-call token counts, the model and a timestamp to local session logs, but the Factory does not read them.

## Solution

The Factory reads those logs at each Stage transition and at `run complete`, and keeps the **Usage** of the Run in the Run record: tokens per Stage and model, with Build split per Ticket. `tds-factory run stats` and the Dashboard show it with the same labels. The Ticket tile on the Dashboard shows the fresh tokens and the models of each Ticket. Only tokens are counted: no prices, no money, no estimates. Where a log is missing or not recognised, the Run says `not tracked`; a Stage with no entries says `no data`. Unknown is never shown as zero.

## User Stories

1. As a user, I want the tokens of a Run per Stage, so that I can see where the work spent them.
2. As a user, I want the tokens per model, so that I can see which models were used and how much each did.
3. As a user, I want the tokens per Ticket, so that I can see which slice of the work was expensive.
4. As a user, I want the same numbers for Claude, Codex and Copilot, so that the Agent target does not decide whether I can see Usage.
5. As a user, I want each row to show input, cache read, cache write and output the same way for every target, so that I can compare targets.
6. As a user, I want one headline number, the fresh tokens (input plus cache write plus output), so that huge cache reads do not hide the real work.
7. As a user, I want the cache reads shown next to the headline number, so that I can still see them.
8. As a user, I want reasoning tokens shown as part of output and never added twice, so that totals stay correct.
9. As a user, I want a field that a target does not report to show `n/a`, so that it is not mistaken for zero.
10. As a user, I want Build usage cut at the Ticket boundaries, so that Ticket N gets the work between the previous Ticket done and its own.
11. As a user, I want the Usage of a Rework in its own bucket, so that the cost of returning to Build is visible and no Ticket is blamed for it.
12. As a user, I want Define, Check and Finish shown at Run level, so that nothing pretends to be per Ticket that is not.
13. As a user of the Fast track, I want the one Ticket to carry all of Build, so that a small Run reads naturally.
14. As a user, I want the tokens of reviewer subagents counted in the Stage and model they ran under, with a subagents column, so that Check is not undercounted and I can see their share.
15. As a user, I want a session to be matched to a Run by the Run id in its log and the Run's Stage windows, so that two Runs started from the same project folder never blur.
16. As a user who resumes a Run in another session, I want all of its sessions counted, so that nothing is lost.
17. As a user of Claude Code, I want the session id recorded when the CLI can see it, so that the match is exact.
18. As a user, I want the numbers read at each Stage transition and at complete, and stored in the Run record, so that they survive the vendor cleaning up its logs.
19. As a user, I want reading the logs to be repeatable, so that reading the same logs twice gives the same numbers.
20. As a user, I want a transition never to fail or slow down because a log is missing, unreadable or in a format the Factory does not know, so that Usage can never stop my work.
21. As a user, I want a Run with no recognised log to say `not tracked` with a short reason, so that I know why.
22. As a user, I want a Stage with no entries to say `no data` while other Stages show numbers, so that a gap is not mistaken for zero.
23. As a user with older Runs, I want their `not tracked` to stay readable and unchanged, so that upgrading breaks nothing.
24. As a user, I want `tds-factory run stats --id` to print the Usage table (Stage by model, with the Ticket split for Build), so that I can read it in the terminal.
25. As a user, I want `tds-factory run stats --all` to add totals per model across Runs, so that I can compare projects over time.
26. As a Dashboard user, I want the Run detail to show the same table with the same labels as the CLI, so that I can read it without a terminal.
27. As a Dashboard user, I want each Ticket tile to show its fresh tokens and its models on a second line, so that I see the cost where I see the progress.
28. As a Dashboard user, I want the active Ticket to show its number so far, so that I can watch it grow.
29. As a Dashboard user, I want a todo Ticket to show no usage line, so that an empty tile does not look like zero.
30. As a Dashboard user, I want hover or keyboard focus on a tile to show the four-field breakdown per model, so that the detail is one gesture away.
31. As a Dashboard user on a narrow screen, I want the usage line to wrap under the Ticket, so that nothing overflows.
32. As a user, I want the Rework bucket shown as its own tile, so that it is clearly not a Ticket.
33. As a privacy-minded user, I want only the model, token counts, timestamps and the Run id match read, and only counts stored, so that no conversation text reaches the Run record.
34. As a project owner, I want `usage: false` in the project config to switch the reading off, so that a project can opt out.
35. As a project owner with a mistake in the config, I want a bad `usage` value to fail the config check with its line, as other settings do.
36. As a maintainer, I want one reader per Agent target behind one interface, with fixtures for each, so that a vendor format change is caught by a test and fixed in one place.
37. As a maintainer, I want an unrecognised format to degrade to `not tracked`, so that a vendor update never produces wrong numbers.

## Implementation Decisions

- **When.** The Run store reads Usage as part of the named operations that move a Run: each successful Stage transition (a Rework is one), and `complete`. Run sync is not a trigger. The read recomputes the whole Run from the logs and replaces the stored Usage atomically with the progress it describes. Ordinary updates cannot supply or replace Usage, as with other metrics (ADR 0006, ADR 0013).
- **Representation.** `metrics.usage` keeps its place in the versioned metrics. A tracked Run holds a status of `tracked`, the list of rows, the sessions that were counted and the time of the read. A row names the Stage, the model, optionally the Ticket number or the Rework bucket, input, cache read, cache write, output, reasoning and the part that came from subagents. An untracked Run holds a status of `not tracked` and a short reason. A field the target does not report is stored as absent and shown as `n/a`. The old shape (`tokens` and `cost` marked `not tracked`) stays readable and is read as not tracked.
- **Readers.** One reader per Agent target, behind one interface: given the Run (its id, its Stage windows, its recorded session ids, its target and the home folder), it returns rows or `not tracked` with a reason. Readers find logs under the user's home: Claude Code project transcripts with their subagent transcripts, Codex rollout files, and Copilot session event files. Readers take the home folder from the environment so tests point them at fixtures.
- **Matching.** A session belongs to a Run when its log contains the Run id and has entries inside the Run's lifetime. Claude's session id, which the CLI reads from the agent's environment, is recorded on the Run by the named operations and used as the exact match; other ids that appear are added. A session that handled more than one Run is cut by each Run's own Stage windows. The working folder is not used to match, because the agent's session folder is the main checkout shared by every Run started from it.
- **Attribution.** Each entry goes to the Stage visit whose window holds its timestamp. Entries outside every visit are ignored. A repeated entry (the same call written twice) is counted once. Build entries are cut at the `ticket-done` events of the Event log: Ticket N is the Nth entry of the Run's `tickets`. Build entries after a Rework go to the Rework bucket. The Fast track has one Ticket and gives it all of the first Build.
- **Fields.** Every row uses input (not from cache), cache read, cache write and output. A target whose input includes cached input (Codex) has the cached part subtracted from input and shown as cache read. Reasoning tokens are shown as "of which reasoning" and are not added to the headline. The fresh tokens are input plus cache write plus output.
- **Failure.** Reading is best-effort and time-bounded. A missing, unreadable or unrecognised log, a timeout, or a malformed entry never fails or noticeably delays an operation. The result is `not tracked` with a reason, or, for a Stage that has no entries while others have, `no data` for that Stage. Nothing in a transition changes if the read fails.
- **Privacy and switch.** Readers keep only the model, the token fields, timestamps and the Run id match. The Run record never holds log text. The project config gains an optional `usage` setting; `false` stops the reading and the Run shows `not tracked` with the reason `switched off in the project config`. The setting is validated like the others and the frozen project settings of a Run carry it.
- **CLI.** `run stats --id` prints a Usage table after the existing metrics: a row per Stage and model with fresh tokens, the four fields, the subagent share, and for Build the Ticket split and the Rework bucket. `run stats --all` adds totals per model. Labels are shared with the Dashboard.
- **Dashboard.** Run detail shows the same table with the same labels, replacing the `Tokens: not tracked` line when Usage is tracked. The Ticket list becomes tiles: line one keeps the status icon and the Ticket link; line two shows the fresh tokens and the short model names, `so far` on the active Ticket, nothing on a todo Ticket. A tile shows the four-field breakdown per model on hover and on keyboard focus. The Rework bucket is its own tile. The second line wraps under the first on narrow screens. Ticket titles are not shown, because the Run record stores only links. The `Cost: not tracked` line stays as it is: money is out of scope.
- **Documents.** The usage and Dashboard guides, the Factory Skill's Run record schema, the glossary terms (Usage, Fresh tokens, Rework bucket, already written), a changelog fragment and the Run metrics Spec's note are updated.

## Testing Decisions

- A good test drives a public operation or command against fixture logs and asserts what the user sees or what the Run record holds, not private helpers or incidental formatting.
- **Seam 1, the Run store operations.** Temporary git repositories with real transitions, a temporary home folder holding small fixture logs for each target (Claude transcript with a subagent transcript, Codex rollout, Copilot events), and controlled timestamps. Assert the stored rows per Stage, model and Ticket; the Rework bucket; the subagent share; matching by Run id when two Runs share a folder; a resumed Run with two sessions; repeat reads giving the same numbers; no write when the setting is off; and unchanged progress when a log is missing, unreadable, truncated or in an unknown format.
- **Seam 2, the CLI.** `run stats --id` and `--all` output for tracked, `not tracked`, `no data` and legacy records, including the normalisation of Codex input and `n/a` fields.
- **Seam 3, the Dashboard browser fixture.** Run detail table and the Ticket tiles for done, active, todo and Rework, the tooltip and focus breakdown, the narrow-screen wrap, and the unchanged wording for untracked and legacy Runs.
- **Project config.** The `usage` setting accepted, rejected with its line, and frozen at Run start.
- **Privacy.** A fixture log with conversation text proves the text never appears in the Run record.
- Prior art: the Run metrics tests, the Run gates and CLI tests, the project config tests and the Dashboard metrics and progress browser tests.

## Out of Scope

- Prices, money, cost estimates and token estimates for logs that report nothing.
- Backfilling Runs finished before this change, or logs that the vendor already deleted.
- Showing Ticket titles, charts, exports and a separate analytics page.
- Reading anything other than the three Agent targets' session logs.
- Changing Evidence, review gates, Rework limits or the Stage model.

## Further Notes

- Whether Codex and Copilot expose a session id to the CLI was not confirmed; their match relies on the Run id in the log. If an id is exposed later, it can join the recorded session ids without a format change.
- The per-call numbers were checked on this machine: Claude Code, Codex and Copilot each hold the model, the token fields and a timestamp per call. A prototype sliced a Claude transcript by the Run's recorded Stage windows and gave plausible Stage and model totals.
