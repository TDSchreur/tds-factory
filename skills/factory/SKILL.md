---
name: factory
description: Run the TDS software factory flow (Define, Prepare, Build, Check, Finish) to take a piece of work from idea to pull request. Use when the user says "factory" or wants to build a feature end to end.
disable-model-invocation: true
---

# Factory

<!-- sync and the skills test find the skills this Skill invokes by the word Invoke followed by a backticked skill name. Keep that phrasing. -->

Walk the work through the Stages below in order. Finish each Stage and tell the user what it produced before starting the next. At each Stage transition, update the Run record. The user can stop or redirect at any Stage.

## Preflight

Before creating the Run folder, check that the user has run `/setup-matt-pocock-skills` in this project: `docs/agents/issue-tracker.md` and `docs/agents/domain.md` exist, and `AGENTS.md` or `CLAUDE.md` has an `## Agent skills` section pointing at them. If anything is missing, stop. Do not start the Run and do not create the files yourself. Tell the user which items are missing and that the Factory cannot work without them. Tell them to run `/setup-matt-pocock-skills` (it sets up the issue tracker, triage labels and domain docs layout), then run `/factory` again.

Then read the project's conventions: `AGENTS.md` or `CLAUDE.md`, the instruction guides it routes to and the canonical specs it lists. Find the verify command in its `## Commands` section. If there is none, ask the user once for the command and record the answer; never guess one. Record the command in `commands` and the paths you read in `conventions` when you create `run.json`.

## Run record

Every Run keeps a Run record that the Dashboard reads. Keep it up to date yourself; do not skip it.

**Start.** Before the first Stage, create the Run folder `.factory/runs/YYYY-MM-DD-<slug-of-title>/` in the project being built, using today's date and a lowercase, hyphenated slug of the work title. If that folder already exists, append `-2`, `-3`, and so on until the name is free. Never reuse or overwrite another Run's folder. Write `run.json` in it, with `check_loops` set to `0`.

**Update.** Rewrite `run.json` whenever a Stage starts (including when Check sends you back to Build), when the work becomes `waiting` on the user or is released again, and when the Run ends. Also rewrite it each time a Ticket is completed (`tickets_done`) and after each review (`standards`, `spec`, `security`, `infrastructure`, `check_loops`). Always refresh `activity` and `updated`. Keep the `created` value and any fields you do not change.

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
| `infrastructure` | `pass`, `fail` or `skipped`: the Infrastructure verdict of the latest review. `fail` while any CRITICAL, HIGH or MEDIUM infrastructure finding is open; `skipped` when no infrastructure file changed. Set after each review, replacing the old value |
| `check_loops` | Number of times Check has sent the Run back to Build, `0` to `2`. Starts at `0`; raise it by 1 on each return to Build |
| `commands` | The verify command, one string. Set by Preflight; the answer the user gave when the project has none |
| `conventions` | Paths of the conventions files Preflight read, an array of strings |
| `created` | ISO 8601 UTC timestamp, set once |
| `updated` | ISO 8601 UTC timestamp, set on every write |
| `spec_link` | Link to the Spec (path or URL). Optional; set once the Spec exists |
| `tickets` | Links to the Tickets, an array of strings: issue URLs or repo-relative file paths, whichever the tracker produces. Optional; set once they exist |
| `pr` | Link to the pull request. Optional; set once it exists |

Record the Spec, Tickets and PR as links only; never copy their content into the Run folder.

### Stage summaries

At the end of each Stage, write a short Markdown summary (a few lines: what was done, what was decided, what is open) into the Run folder: `define.md`, `build.md`, `check-N.md` (one per Check pass, `N` counting from 1, so a Check that sends you back to Build and runs again writes `check-2.md`; it holds a Standards, a Spec, a Security and an Infrastructure section), and `finish.md`. Write plain Markdown only; the Dashboard shows these files as plain text. Never overwrite another Stage's file.

## Waiting on the user

Set `status` to `waiting`, `waiting_on_human` to `true` and `waiting_reason` to a short line, and write `run.json`, before you ask the user at each of these points:

- Define: a question for the user or confirmation of the shared understanding after grilling.
- Check: after the loop cap, when problems are still open.
- Finish: when the `infrastructure` verdict is `fail`, or "not validated" for a changed infrastructure file, to ask whether to accept the risk.
- Finish: before pushing or opening the PR.

When the user answers and the Run continues, set `status` back to `running`, `waiting_on_human` to `false` and `waiting_reason` to an empty string, and write `run.json` before doing anything else. Also clear them when the Run ends. If an answer needs no work before your next question, skip that clearing write: set the new `waiting_reason` in the next `waiting` write and write `running` only when real work starts.

## Define

1. Invoke `grill-with-docs` to settle what has to be done, starting from the work description the user gave with `/factory`; do not ask for it again. Update `GLOSSARY.md` and `docs/adr/` as it goes.
2. Invoke `to-spec` to write the Spec as a Markdown file in `docs/specs/`. Choose the test seams yourself and proceed without asking for seam confirmation or Spec sign-off.
3. Invoke `to-tickets` to cut the Spec into Tickets, published to the Issue tracker named in `docs/agents/issue-tracker.md`, local Markdown when that file names no tracker. Choose the breakdown and publish it without asking the user to review or approve it. If a label the tracker needs does not exist, ask the user before creating it.

## Prepare

Invoke `ponytail` so the Build stage writes the minimum code that works.

## Build

Build only starts when the Spec file named in `spec_link` exists and `tickets` is not empty. If either is missing, do not build: set `stage` to `define` in `run.json`, say what is missing, and continue Define from there.

Start on a branch named after the Run slug, off the default branch, and commit the Define artifacts first. Invoke `implement-spec`, working test-first with `tdd`, with one commit per Ticket, until every Ticket is done. After each Ticket, run the verify command and fix failures before moving on. List any command that cannot run in this environment (other shell, no container runtime) under "Not run" in `build.md`, and never report it as passed. Work inline, with no subagents, and skip the closing `code-review` step of `implement-spec`; Check owns the review.

## Check

In one pass, review the changes on four axes, each in its own fresh read-only subagent so the reviewer did not write the code. Invoke `code-review` for the Standards and Spec axes; it runs one subagent for each. Invoke `security-scan` for the Security axis, in a third subagent. Report each axis separately and never merge them. Run every axis on every Run; Infrastructure is the one that may be `skipped`. Give the Standards subagent every instruction guide from `conventions` whose `applyTo` globs match the changed files, and have it flag a change that leaves the canonical spec for that area stale when the changed behavior is documented there: a stale canonical spec is a Standards finding worth fixing. Give the Security subagent the project's "Universal safeguards" text from the conventions file, to check explicitly next to the generic patterns. A project with no guides or safeguards is reviewed as before. The Infrastructure axis runs in a fourth fresh read-only subagent, with no new Skill, when the diff changes `*.bicep`, `*.bicepparam`, `bicepconfig.json`, files under `Pipelines/`, `azure-pipelines*.yml` or `*.pipeline.yml`; otherwise its verdict is `skipped`. It runs `bicep build` and `bicep lint` with the project's `bicepconfig.json`. If private modules cannot be restored, it reports "not validated" with the reason, never `pass`. It runs a what-if only when Azure credentials and a documented target exist, and it must never deploy. It checks changed pipeline YAML for plaintext secrets, unpinned task or template versions and missing approval gates on production stages, and checks the project's stated invariants (for example no Blob soft delete). An axis with no verdict in `run.json` after the pass is a problem worth fixing: go back to Build and run it again. Scope `security-scan` to the files in the same diff `code-review` uses, and run it on every Run. Problems worth fixing are the `code-review` findings you judge worth fixing, plus every CRITICAL, HIGH or MEDIUM security or infrastructure finding; LOW and INFO findings are only reported. If there are problems worth fixing, go back to Build and fix them (the security report only proposes patches; Build applies them), then review again. All axes share one loop count: go back at most 2 times; after that, report what is still open and continue to Finish.

## Finish

Infrastructure is the one axis that blocks Finish; the other axes still report and continue after the loop cap. Check the `infrastructure` verdict in `run.json` before invoking `pr`. On `fail`, or "not validated" for a changed infrastructure file, set the Run to `waiting` with a `waiting_reason` and ask the user whether to accept the risk. Prepare the PR only after an explicit yes, and record the decision in `finish.md`. On `pass` or `skipped`, go straight on.

Invoke `pr` to prepare the pull request. If the project has a PR template at `.github/pull_request_template.md`, `.azuredevops/pull_request_template.md` or `docs/pull_request_template.md`, pass it to `pr` and fill it in, including its Infrastructure checklist from the `infrastructure` verdict; otherwise keep the layout `pr` produces. Then Invoke `unslop` on the PR title and the prose of the body, and leave diagrams, diffs, code blocks, Evidence output and the template's bold labels as they are. Save the cleaned draft as plain Markdown in `pr.md` in the Run folder. When the tracker is GitHub, the PR body lists `Closes #N` for every Ticket; otherwise it lists the Ticket paths and has no `Closes` lines. Do not push or open it without the user's go-ahead. When the PR is handled, set `status` to `done`.
