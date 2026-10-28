---
name: factory
description: Run the TDS software factory flow (Define, Prepare, Build, Check, Finish) to take a piece of work from idea to pull request. Use when the user says "factory" or wants to build a feature end to end.
disable-model-invocation: true
---

# Factory

Walk the work through the Stages below in order. Finish each Stage and tell the user what it produced before starting the next. At each Stage transition, update the Run record. The user can stop or redirect at any Stage.

## Run record

Every Run keeps a Run record that the Dashboard reads. Keep it up to date yourself; do not skip it.

**Start.** Before the first Stage, create the Run folder `.factory/runs/YYYY-MM-DD-<slug-of-title>/` in the project being built, using today's date and a lowercase, hyphenated slug of the work title. If that folder already exists, append `-2`, `-3`, and so on until the name is free. Never reuse or overwrite another Run's folder. Write `run.json` in it.

**Update.** Rewrite `run.json` whenever a Stage starts (including when Check sends you back to Build), when the work becomes `waiting` on the user or is released again, and when the Run ends. Always refresh `activity` and `updated`. Keep the `created` value and any fields you do not change.

**Gitignore.** If `.factory/` is not covered by the project's `.gitignore`, tell the user to add it. Do not edit `.gitignore` yourself.

**Stop.** If the user tells you to stop, set `status` to `abandoned`.

### Schema

`run.json` is one JSON object. Every agent writes exactly this shape, whichever Agent target it is. Add new fields only when this section says so.

| Field | Value |
| --- | --- |
| `title` | Short human title of the work |
| `stage` | `define`, `prepare`, `build`, `check` or `finish` |
| `status` | `running`, `waiting` (blocked on the user), `done` or `abandoned` |
| `waiting_on_human` | Boolean, `true` while blocked on the user, otherwise `false` |
| `waiting_reason` | Short line saying what the user must do, e.g. `sign off the Spec`; empty string when not waiting |
| `activity` | One short line on what is happening now, e.g. `implementing ticket #12` |
| `agent` | Name of the writing agent: `claude`, `codex` or `copilot` |
| `created` | ISO 8601 UTC timestamp, set once |
| `updated` | ISO 8601 UTC timestamp, set on every write |
| `spec` | Link to the Spec (path or URL). Optional; set once the Spec exists |
| `tickets` | Links to the Tickets, an array of strings (issue URLs). Optional; set once they exist |
| `pr` | Link to the pull request. Optional; set once it exists |

Record the Spec, Tickets and PR as links only; never copy their content into the Run folder.

### Stage summaries

At the end of each Stage, write a short Markdown summary (a few lines: what was done, what was decided, what is open) into the Run folder: `define.md`, `build.md`, `check-N.md` (one per Check pass, `N` counting from 1, so a Check that sends you back to Build and runs again writes `check-2.md`), and `finish.md`. Write plain Markdown only; the Dashboard shows these files as plain text. Never overwrite another Stage's file.

## Waiting on the user

Set `status` to `waiting`, `waiting_on_human` to `true` and `waiting_reason` to a short line, and write `run.json`, before you ask the user at each of these points:

- Define: a question for the user, and the Spec sign-off.
- Check: after the loop cap, when problems are still open.
- Finish: before pushing or opening the PR.

When the user answers and the Run continues, set `status` back to `running`, `waiting_on_human` to `false` and `waiting_reason` to an empty string, and write `run.json` before doing anything else. Also clear them when the Run ends.

## Define

1. Invoke `grill-with-docs` to settle what has to be done. Update `GLOSSARY.md` and `docs/adr/` as it goes.
2. Invoke `to-spec` to write the Spec as a Markdown file in `docs/specs/`.
3. Invoke `to-tickets` to cut the Spec into Tickets, stored as GitHub Issues.

## Prepare

Invoke `ponytail` so the Build stage writes the minimum code that works.

## Build

Invoke `implement-spec`, working test-first with `tdd`, until every Ticket is done.

## Check

Invoke `code-review` on the changes. If it finds problems worth fixing, go back to Build and fix them, then review again. Go back at most 2 times; after that, report what is still open and continue to Finish.

## Finish

Invoke `pr` to prepare the pull request. Do not push or open it without the user's go-ahead. When the PR is handled, set `status` to `done`.
