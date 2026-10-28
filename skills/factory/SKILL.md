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

Check that `tds-factory` is on PATH by running `tds-factory` and checking it exits successfully. If it is unavailable, stop before creating a Run and tell the user to install the Factory CLI globally (for a checkout, run `npm install -g .` there) and make it available on PATH.

Then read the project's conventions: `AGENTS.md` or `CLAUDE.md`, the instruction guides it routes to and the canonical specs it lists. Find the verify command in its `## Commands` section. If there is none, tell the user and ask once for the command, set the Run to `waiting` while you ask, and record the answer; never guess one. Record the command in `commands` and the paths you read in `conventions` when you create `run.json`.

## Run record

Every Run keeps a Run record that the Dashboard reads. Keep it up to date yourself; do not skip it.

**Start.** Before the first Stage, run `tds-factory run start --data '<JSON>'` in the project being built. Supply a JSON object containing `title`, `agent`, `commands` and `conventions`. The command prints the new Run id; keep it for every update. It creates a unique dated folder and initializes the record, and a Run worktree: a git worktree on a branch named after the Run id, in `.factory/worktrees/<id>`; its path is the `worktree` field of `run.json`. Do all the work of every Stage, Define included, inside the Run worktree, never in the main checkout, so agents in other tabs do not share your files. Every start creates a new worktree from the freshly fetched current default branch of `origin`, including when started inside a linked worktree. If origin cannot be reached or its default branch cannot be determined, start fails; tell the user. `tds-factory` commands write to the main checkout's Run store from either place. If the project is not a git repository or has no commit, `run start` fails: tell the user. If no verify command is known yet, use an empty `commands` string until the user answers.

**Update.** Use `tds-factory run update --id <id> --data '<JSON>'` for every Run record change; never write `run.json` directly. Supply only changed fields as a JSON object. The command preserves other fields and `created`, refreshes `updated`, validates changes and replaces the record safely. Set `activity` on every update. Update whenever a Stage starts (including when Check sends you back to Build), when work becomes `waiting` or is released, when a Ticket completes, after each review, and when the Run ends. Record `standards`, `spec`, `security`, `infrastructure` and `check_loops` as they change. For waiting, see "Waiting on the user". Check command errors and resolve them before continuing.

**Gitignore.** If `.factory/` is not covered by the project's `.gitignore`, tell the user to add it. Do not edit `.gitignore` yourself.

**Stop.** If the user tells you to stop, set `status` to `abandoned`.

After changing this skill, re-run `tds-factory install` so the installed copy is updated.

### Schema

`run.json` is one JSON object. The command maintains this shape for every Agent target. Add new fields only when this section says so.

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
| `infrastructure` | `pass`, `fail` or `skipped`: the Infrastructure verdict of the latest review. `fail` while any CRITICAL, HIGH or MEDIUM infrastructure finding is open, or a changed infrastructure file is not validated; write `skipped` when no infrastructure file changed. Set after each review, replacing the old value |
| `check_loops` | Number of times Check has sent the Run back to Build, `0` to `2`. Starts at `0`; raise it by 1 on each return to Build |
| `worktree` | Path of the Run worktree the Run works in. Set by `run start` |
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

Before you ask the user at each of these points, update the Run with `status` `waiting` and a short `waiting_reason`; the command sets `waiting_on_human`:

- Preflight: no verify command was found, before asking for it.
- Define: a question for the user or confirmation of the shared understanding after grilling.
- Check: when any axis is `fail`, or the loop cap is reached with problems still open, to ask for permission to continue to Finish.

When the user answers and the Run continues, set `status` back to `running` before doing anything else; the command clears the flag and the reason, also when the Run ends. If an answer needs no work before your next question, skip that clearing write: set the new `waiting_reason` in the next `waiting` write and write `running` only when real work starts.

## Stage agents

`tds-factory install` also installs four Stage agents per Agent target: `factory-define` (Define and Prepare), `factory-build`, `factory-check` (read-only) and `factory-finish`. Their model choices are the user's to edit; install never overwrites an existing agent file. When the client can dispatch to a named agent, hand the Stage's work to it with the instructions of that Stage; otherwise do the work yourself. You stay the coordinator: you talk to the user (relay Define questions and answers), own the Run record, approvals, Check loops and the push. After a handoff, say which agent ran, and report plainly when the requested model was unavailable, substituted or cannot be verified; never claim a model was used that you cannot confirm.

## Define

1. Invoke `grill-with-docs` to settle what has to be done, starting from the work description the user gave with `/factory`; do not ask for it again. Update `GLOSSARY.md` and `docs/adr/` as it goes.
2. Invoke `to-spec` to write the Spec as a Markdown file in `docs/specs/`. Choose the test seams yourself and proceed without asking for seam confirmation or Spec sign-off.
3. Invoke `to-tickets` to cut the Spec into Tickets, published to the Issue tracker named in `docs/agents/issue-tracker.md`, local Markdown when that file names no tracker. Choose the breakdown and publish it without asking the user to review or approve it. If a label the tracker needs does not exist, ask the user before creating it.

## Prepare

Invoke `ponytail` in lite mode (`lite` as its argument) so the Build stage builds what the Ticket asks and names any smaller option in one line.

## Build

Build only starts when the Spec file named in `spec_link` exists and `tickets` is not empty. If either is missing, do not build: set `stage` to `define` in `run.json`, say what is missing, and continue Define from there.

Work in the Run worktree, on its branch, and commit the Define artifacts first. If the verify command fails for missing dependencies, run the project's normal setup in the worktree. Invoke `implement-spec`, working test-first with `tdd`, with one commit per Ticket, until every Ticket is done. After each Ticket, run the verify command and fix failures before moving on. List any command that cannot run in this environment (other shell, no container runtime) under "Not run" in `build.md` or `check-N.md`, and never report it as passed. The Build agent works inline and creates no subagents. Skip the closing `code-review` step of `implement-spec`; Check owns the review.

## Check

In one pass, review the changes on four axes, each in its own fresh read-only subagent so the reviewer did not write the code. Report each axis separately and never merge them. Run every axis on every Run; Infrastructure is the one that may be `skipped`.

Invoke `code-review` for the Standards and Spec axes; it runs one subagent for each. Invoke `security-scan` for the Security axis, in a third subagent. Scope `security-scan` to the files in the same diff `code-review` uses. Give the Standards subagent every instruction guide from `conventions` whose `applyTo` globs match the changed files, and have it flag a change that leaves the canonical spec for that area stale when the changed behavior is documented there: a stale canonical spec is a Standards finding worth fixing. Give the Security subagent the project's "Universal safeguards" text from the conventions file, to check explicitly next to the generic patterns. A project with no guides or safeguards is reviewed as before.

The Infrastructure axis runs in a fourth fresh read-only subagent, with no new Skill, when the diff changes `*.bicep`, `*.bicepparam`, `bicepconfig.json`, files under `Pipelines/`, `azure-pipelines*.yml` or `*.pipeline.yml`; otherwise write `skipped` to `run.json`. It runs `bicep build` and `bicep lint` with the project's `bicepconfig.json`. If private modules cannot be restored, it reports "not validated" with the reason and the verdict is `fail`, never `pass`. It runs a what-if only when Azure credentials and a documented target exist, and it must never deploy; a what-if that is not run because credentials or a target are missing is reported as not run. It checks changed pipeline YAML for plaintext secrets, unpinned task or template versions and missing approval gates on production stages, and checks the project's stated invariants (for example no Blob soft delete).

An axis with no verdict in `run.json` after the pass is a problem worth fixing: run that axis again. Other problems worth fixing are the `code-review` findings you judge worth fixing, plus every CRITICAL, HIGH or MEDIUM security or infrastructure finding; LOW and INFO findings are only reported. If there are problems worth fixing, go back to Build and fix them (the security report only proposes patches; Build applies them), then review again. All axes share one loop count: go back at most 2 times.

Only a clean Check continues to Finish without asking. A Check is clean when every axis verdict is `pass`, with Infrastructure allowed to be `skipped`; an axis with no verdict, or a changed infrastructure file that is not validated, counts as `fail`. When Check would otherwise move on (no problem worth fixing is left, or the loop cap is reached) but the Check is not clean or problems worth fixing are still open, report what is still open, set the Run to `waiting` with a `waiting_reason` and ask the user for permission to continue to Finish, listing the open axes and findings. Continue only after an explicit yes, and record the decision in `finish.md`. On a no, or if the user tells you to stop, set `status` to `abandoned`.

## Finish

Invoke `pr` to prepare the pull request. If the project has a PR template at `.github/pull_request_template.md`, `.azuredevops/pull_request_template.md` or `docs/pull_request_template.md`, pass it to `pr` and fill it in, including its Infrastructure checklist from the `infrastructure` verdict and its Documentation checklist from the stale-spec check; otherwise keep the layout `pr` produces. Then Invoke `unslop` on the PR title and the prose of the body, and leave diagrams, diffs, code blocks, Evidence output and the template's bold labels as they are. Save the cleaned draft as plain Markdown in `pr.md` in the Run folder. When the tracker is GitHub, the PR body lists `Closes #N` for every Ticket; otherwise it lists the Ticket paths and has no `Closes` lines. Push the branch and open the PR. When the PR is handled, set `status` to `done`.
