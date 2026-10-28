---
name: factory
description: Run the TDS software factory flow (Define, Prepare, Build, Check, Finish) to take a piece of work from idea to pull request. Use when the user says "factory" or wants to build a feature end to end.
disable-model-invocation: true
---

# Factory

<!-- sync and the skills test find the skills this Skill invokes by the word Invoke followed by a backticked skill name. Keep that phrasing. -->

Walk the work through the Stages below in order. Finish each Stage and tell the user what it produced before starting the next. At each Stage transition, update the Run record. The user can stop or redirect at any Stage.

## Stage models

The main agent coordinates the Run, keeps the Run record, communicates with the user and dispatches the installed `factory-define`, `factory-build`, `factory-check` and `factory-finish` agents for the corresponding Stages. Prepare runs with Define. Use the Agent target's native named-agent dispatch, not a request to change the main agent's model. Give each worker the Run context, relevant skill instructions and its exact task; collect and check its result before advancing. If a target cannot dispatch the named agent, report that model routing is unavailable and continue only with an explicit user decision.

Model choices are in the target's installed agent files. At each dispatch, report the requested model and, if the client exposes it, the actual model. Report substitutions and unverified actual models; never claim a model ran solely because its profile requested it. If dispatch fails or a model cannot be used, report the failure and ask the user how to proceed. Copilot CLI Auto mode inherits the session model for subagents, so report this and use a non-Auto session for configured Stage models.

The coordinator relays Define questions and answers between the user and the Define agent, including confirmation of shared understanding, then dispatches the remaining Define work. The coordinator keeps the existing approval points. Use a fresh `factory-check` agent for each Check axis; they must not write and must not have implemented the change.

## Run record

Every Run keeps a Run record that the Dashboard reads. Keep it up to date yourself; do not skip it.

**Start.** Before the first Stage, create the Run folder `.factory/runs/YYYY-MM-DD-<slug-of-title>/` in the project being built, using today's date and a lowercase, hyphenated slug of the work title. If that folder already exists, append `-2`, `-3`, and so on until the name is free. Never reuse or overwrite another Run's folder. Write `run.json` in it, with `check_loops` set to `0`.

**Update.** Rewrite `run.json` whenever a Stage starts (including when Check sends you back to Build), when the work becomes `waiting` on the user or is released again, and when the Run ends. Also rewrite it each time a Ticket is completed (`tickets_done`) and after each review (`standards`, `spec`, `security`, `check_loops`). Always refresh `activity` and `updated`. Keep the `created` value and any fields you do not change.

**Gitignore.** If `.factory/` is not covered by the project's `.gitignore`, tell the user to add it. Do not edit `.gitignore` yourself.

**Stop.** If the user tells you to stop, set `status` to `abandoned`, `waiting_on_human` to `false` and `waiting_reason` to an empty string.

After changing this skill, re-run `tds-factory install` so the installed copy is updated.

### Schema

`run.json` is one JSON object. Every agent writes exactly this shape, whichever Agent target it is. Add new fields only when this section says so.

| Field | Value |
| --- | --- |
| `title` | Short human title of the work |
| `stage` | `define`, `prepare`, `build`, `check` or `finish` |
| `status` | `running`, `waiting` (blocked on the user), `done` or `abandoned` |
| `waiting_on_human` | Boolean, `true` while blocked on the user, otherwise `false` |
| `waiting_reason` | Short line saying what the user must do, e.g. `confirm the shared understanding`; empty string when not waiting |
| `activity` | One short line on what is happening now, e.g. `implementing ticket #12` |
| `agent` | Name of the writing agent: `claude`, `codex` or `copilot` |
| `tickets_total` | Number of Tickets cut from the Spec. Set once the Tickets exist |
| `tickets_done` | Number of those Tickets finished. Raise it each time a Ticket is completed during Build |
| `standards` | `pass` or `fail`: the Standards verdict of the latest `code-review`. Set after each review, replacing the old value |
| `spec` | `pass` or `fail`: the Spec verdict of the latest `code-review`. Set after each review, replacing the old value |
| `security` | `pass` or `fail`: the Security verdict of the latest `security-scan`. `fail` while any CRITICAL, HIGH or MEDIUM finding is open. Set after each review, replacing the old value |
| `check_loops` | Number of times Check has sent the Run back to Build, `0` to `2`. Starts at `0`; raise it by 1 on each return to Build |
| `created` | ISO 8601 UTC timestamp, set once |
| `updated` | ISO 8601 UTC timestamp, set on every write |
| `spec_link` | Link to the Spec (path or URL). Optional; set once the Spec exists |
| `tickets` | Links to the Tickets, an array of strings (issue URLs). Optional; set once they exist |
| `pr` | Link to the pull request. Optional; set once it exists |

Record the Spec, Tickets and PR as links only; never copy their content into the Run folder.

### Stage summaries

At the end of each Stage, write a short Markdown summary (a few lines: what was done, what was decided, what is open) into the Run folder: `define.md`, `build.md`, `check-N.md` (one per Check pass, `N` counting from 1, so a Check that sends you back to Build and runs again writes `check-2.md`; it holds a Standards, a Spec and a Security section), and `finish.md`. Write plain Markdown only; the Dashboard shows these files as plain text. Never overwrite another Stage's file.

## Waiting on the user

Set `status` to `waiting`, `waiting_on_human` to `true` and `waiting_reason` to a short line, and write `run.json`, before you ask the user at each of these points:

- Define: a question for the user or confirmation of the shared understanding after grilling.
- Check: after the loop cap, when problems are still open.
- Finish: before pushing or opening the PR.

When the user answers and the Run continues, set `status` back to `running`, `waiting_on_human` to `false` and `waiting_reason` to an empty string, and write `run.json` before doing anything else. Also clear them when the Run ends. If an answer needs no work before your next question, skip that clearing write: set the new `waiting_reason` in the next `waiting` write and write `running` only when real work starts.

## Define

1. Invoke `grill-with-docs` to settle what has to be done, starting from the work description the user gave with `/factory`; do not ask for it again. Update `GLOSSARY.md` and `docs/adr/` as it goes.
2. Invoke `to-spec` to write the Spec as a Markdown file in `docs/specs/`. Choose the test seams yourself and proceed without asking for seam confirmation or Spec sign-off.
3. Invoke `to-tickets` to cut the Spec into Tickets, stored as GitHub Issues. Choose the breakdown and publish it without asking the user to review or approve it. If a label the tracker needs does not exist, ask the user before creating it.

## Prepare

Invoke `ponytail` so the Build stage writes the minimum code that works.

## Build

Start on a branch named after the Run slug, off the default branch, and commit the Define artifacts first. Invoke `implement-spec`, working test-first with `tdd`, with one commit per Ticket, until every Ticket is done. The Build agent works without further subagents and skips the closing `code-review` step of `implement-spec`; Check owns the review.

## Check

In one pass, review the changes on three axes, each in its own fresh read-only subagent so the reviewer did not write the code. Invoke `code-review` for the Standards and Spec axes; it runs one subagent for each. Invoke `security-scan` for the Security axis, in a third subagent. Report each axis separately and never merge them. Scope `security-scan` to the files in the same diff `code-review` uses, and run it on every Run. Problems worth fixing are the `code-review` findings you judge worth fixing, plus every CRITICAL, HIGH or MEDIUM security finding; LOW and INFO findings are only reported. If there are problems worth fixing, go back to Build and fix them (the security report only proposes patches; Build applies them), then review again. All axes share one loop count: go back at most 2 times; after that, report what is still open and continue to Finish.

## Finish

Invoke `pr` to prepare the pull request. Then Invoke `unslop` on the PR title and the prose of the body, and leave diagrams, diffs, code blocks, Evidence output and the template's bold labels as they are. Save the cleaned draft as plain Markdown in `pr.md` in the Run folder. The PR body lists `Closes #N` for every Ticket. Do not push or open it without the user's go-ahead. When the PR is handled, set `status` to `done`.
