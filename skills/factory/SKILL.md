---
name: factory
description: Run the TDS software factory flow (Define, Build, Check, Finish) to take a piece of work from idea to pull request. Use when the user says "factory" or wants to build a feature end to end.
---

# Factory

<!-- sync, doctor and the skills test find the skills this Skill invokes by the word Invoke followed by a backticked skill name. Keep that phrasing. -->

Walk the work through the Stages below in order. Finish each Stage and tell the user what it produced before starting the next. Move the Run to each next Stage with `tds-factory run transition`. The user can stop or redirect at any Stage.

## Preflight

Check that `tds-factory` is on PATH by running `tds-factory` and checking it exits successfully. If it is unavailable, stop before creating a Run and tell the user to install the Factory CLI globally (for a checkout, run `npm install -g .` there) and make it available on PATH.

Then run `tds-factory doctor --json --agent <your agent>`, which changes nothing, before creating the Run folder. It checks the CLI version, the required Skills, the tracker setup (`docs/agents/issue-tracker.md`, `docs/agents/domain.md` and an `## Agent skills` section in `AGENTS.md` or `CLAUDE.md`), the Git `origin` and its default branch, the review capabilities and the Verify command. Each check is `pass`, `missing` or `fail`. If any check other than `verify-command` is not `pass`, stop. Do not start the Run and do not create files yourself. Tell the user each failing check and its message, and that the Factory cannot work until they are fixed, then run `/factory` again. Do not suggest a setup command the message does not name. A `fail` of `verify-command` means the command exists but cannot be used (empty, a NUL byte, or a first word that cannot be found): stop and tell the user, never replace it with a guess. A `missing` Verify command is handled below. The report may also list `notes`, such as merged Runs that still hold a worktree; they never stop a Run. Mention them to the user and carry on.

Then read the project's conventions: `AGENTS.md` or `CLAUDE.md`, the instruction guides it routes to and the canonical specs it lists. Find the verify command in its `## Commands` section (the same line `doctor` read). Record the command in `commands` and the paths you read in `conventions` when you create the Run. If there is no verify command, tell the user, create the Run now with an empty `commands`, set it to `waiting` while you ask once for the command, and record the answer with `run update`; never guess one.

## Run record

Every Run keeps a Run record that the Dashboard reads. Keep it up to date yourself; do not skip it.

**Start.** Before the first Stage, run `tds-factory run start --data '<JSON>'` in the project being built. Supply a JSON object containing `title`, `agent`, `commands` and `conventions`. The command prints the new Run id; keep it for every update. It creates a unique dated folder and initializes the record, and a Run worktree: a git worktree on a branch named after the Run id, in `.factory/worktrees/<id>`; its path is the `worktree` field of `run.json`. Do all the work of every Stage, Define included, inside the Run worktree, never in the main checkout, so agents in other tabs do not share your files. Every start creates a new worktree from the freshly fetched current default branch of `origin`, including when started inside a linked worktree. If origin cannot be reached or its default branch cannot be determined, start fails; tell the user. `tds-factory` commands write to the main checkout's Run store from either place. If the project is not a git repository or has no commit, `run start` fails: tell the user. An empty `commands` string stands for a verify command the user has not given yet.

**Update.** Use `tds-factory run update --id <id> --data '<JSON>'` for notes on progress; never write `run.json` directly. Supply only changed fields as a JSON object. The command preserves other fields and `created`, refreshes `updated`, validates changes and replaces the record safely. Set `activity` on every update. Update when work becomes `waiting` or is released, when a Ticket completes (`tickets_done`), when the Spec, Tickets or PR links exist, and when the Run is stopped. `run update` cannot change `stage`, `check_loops`, the verdicts, `verify`, `reviewed`, `accepted`, `worktree` or `base_sha`, cannot set `status` to `done`, and sets `commands` only once, while it is empty; the commands below do the rest. For waiting, see "Waiting on the user". Check command errors and resolve them before continuing.

**Progress commands.** Each checks its prerequisites and refuses with a message saying what is missing; fix that, never work around it.

- `tds-factory run transition --id <id> --to build|check|finish` moves to the next Stage, in order. Add `--data '{"activity":"..."}'` to set the activity line. Build needs the Spec link and Tickets, Check needs every Ticket done, Finish needs a clean or accepted Check (see Check). Finish also needs a branch that merges cleanly into the fetched default branch of `origin`; when it does not, run `tds-factory run sync`, resolve the conflicts and review again. Build, Check and Finish also need a usable Verify command, and `run verify` refuses without one.
- `tds-factory run verify --id <id>` runs the verify command in the Run worktree and records the Verify result: command, head commit, whether the worktree had uncommitted changes, exit code, times and `verify.log` in the Run folder.
- `tds-factory run verdict --id <id> --axis standards|spec|security|infrastructure --value pass|fail|skipped` records one Check axis verdict for the current head. Only Infrastructure may be `skipped`, and a `pass` or `skipped` on a worktree with uncommitted changes is refused.
- `tds-factory run rework --id <id>` sends a Run in Check back to Build: it counts the loop (at most 4) and clears the verdicts, the Verify result and any accepted decision.
- `tds-factory run sync --id <id>` rebases the Run branch onto the freshly fetched default branch of `origin` in Build or Check. It refuses uncommitted changes, and on a conflict it names the files and leaves the branch unchanged. It clears the Evidence when the head moves, without counting a loop.
- `tds-factory run accept --id <id> --data '{"findings":"...","decision":"..."}'` records the user's decision to continue to Finish with a Check that is not clean, for the current head only.
- `tds-factory run complete --id <id>` ends a Run in Finish that has a `pr` link and sets `status` to `done`.
- `tds-factory run clean --id <id> | --all` removes the worktree and local branch of a Run whose recorded PR is merged, from the main checkout only. It keeps the Run record, and leaves a Run that is not done, has an unmerged PR, uncommitted changes, submodule work that exists nowhere else, or branch commits outside the merged PR in place, saying why.
- `tds-factory run inspect [--id <id>] [--json]` reports records that cannot be read, lock ownership, orphaned, missing, unknown or dirty worktrees, and stale Evidence without changing anything.
- `tds-factory run repair --id <id>` prints a repair proposal; add `--apply` only after reviewing it. It reconciles git and GitHub, preserves dirty worktrees, may reconstruct missing records and only clears a lock whose same-host owner is demonstrably dead. It never clears a lock because of age. Inspect a reported repair coordination lock and resolve it manually.

Evidence is the Verify result and the verdicts, each tied to the head commit it was recorded for. A commit made afterwards makes it stale, and Finish only accepts current Evidence.

**Gitignore.** If `.factory/` is not covered by the project's `.gitignore`, tell the user to add it. Do not edit `.gitignore` yourself.

**Stop.** If the user tells you to stop, set `status` to `abandoned`.

After changing this skill, re-run `tds-factory install` so the installed copy is updated.

### Schema

`run.json` is one JSON object. The command maintains this shape for every Agent target. Add new fields only when this section says so.

| Field | Value |
| --- | --- |
| `title` | Short human title of the work |
| `stage` | `define`, `build`, `check` or `finish` |
| `status` | `running`, `waiting` (blocked on the user), `verification-unavailable`, `interrupted`, `done` or `abandoned` |
| `waiting_on_human` | Boolean, `true` while blocked on the user, otherwise `false` |
| `waiting_reason` | Short line saying what the user must do, e.g. `confirm the shared understanding`; empty string when not waiting |
| `status_reason` | Nonempty explanation when `verification-unavailable` or `interrupted`; empty when running or waiting |
| `activity` | One short line on what is happening now, e.g. `implementing ticket #12` |
| `agent` | Name of the writing agent: `claude`, `codex` or `copilot` |
| `tickets_total` | Number of Tickets cut from the Spec. Set once the Tickets exist |
| `tickets_done` | Number of those Tickets finished. Raise it each time a Ticket is completed during Build |
| `standards` | `pass` or `fail`: the Standards verdict of the latest `code-review`. Set with `run verdict` after each review |
| `spec` | `pass` or `fail`: the Spec verdict of the latest `code-review`. Set with `run verdict` after each review |
| `security` | `pass` or `fail`: the Security verdict of the latest `security-scan`. `fail` while any CRITICAL, HIGH or MEDIUM finding is open. Set with `run verdict` after each review |
| `infrastructure` | `pass`, `fail` or `skipped`: the Infrastructure verdict of the latest review. `fail` while any CRITICAL, HIGH or MEDIUM infrastructure finding is open, or a changed infrastructure file is not validated; write `skipped` when no infrastructure file changed. Set with `run verdict` after each review |
| `check_loops` | Number of times Check has sent the Run back to Build, `0` to `4`. Starts at `0`; `run rework` raises it by 1 on each return to Build |
| `worktree` | Path of the Run worktree the Run works in. Set by `run start` |
| `base_sha` | Commit the Run branched from: the fetched `origin` default branch head. Set by `run start` |
| `verify` | The latest Verify result, an object. Set by `run verify` |
| `reviewed` | For each axis with a verdict, the head and Check attempt it was recorded for. Set by `run verdict` |
| `accepted` | The user's decision to continue with a Check that is not clean: findings, decision, head and time. Set by `run accept` |
| `commands` | The verify command, one string. Set by Preflight; the answer the user gave when the project has none. It can be set once; changing it means starting a new Run |
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

- Preflight: no verify command was found, after creating the Run with an empty `commands` and before asking for it.
- Define: a question for the user or confirmation of the shared understanding after grilling.
- Check: when any axis is `fail`, or the loop cap is reached with problems still open, to ask for permission to continue to Finish.

If verification cannot run, set `verification-unavailable` with a `status_reason`; if the agent is interrupted, set `interrupted` with a `status_reason`. Resume either explicitly with `status` `running`. A failed Verify command is not an unavailable one.

When the user answers and the Run continues, set `status` back to `running` before doing anything else; the command clears the flag and the reason, also when the Run ends. If an answer needs no work before your next question, skip that clearing write: set the new `waiting_reason` in the next `waiting` write and write `running` only when real work starts.

## Stage agents

`tds-factory install` also installs four Stage agents per Agent target: `factory-define` (Define), `factory-build`, `factory-check` (read-only) and `factory-finish`. Their model choices are the user's to edit; install never overwrites an existing agent file. When the client can dispatch to a named agent, hand the Stage's work to it with the instructions of that Stage; otherwise do the work yourself. You stay the coordinator: you talk to the user (relay Define questions and answers), own the Run record, approvals, Check loops and the push. After a handoff, say which agent ran, and report plainly when the requested model was unavailable, substituted or cannot be verified; never claim a model was used that you cannot confirm. The Check agents are read-only and may not run commands: collect the diff and run any validation (such as `bicep build` and `bicep lint`) yourself, and pass the output with the assignment.

## Invoked Skills

The Skills named in Define and Build have upstream defaults that conflict with the Flow. This section is the invocation contract: where it and an upstream step disagree, follow this section. Do not ask the user for an approval, confirmation or review that this section or a Stage below already resolved. Each `Overrides "..."` quotes the upstream sentence it replaces.

- **to-spec.** Overrides "Check with the user that these seams match their expectations." Choose the seams yourself. Overrides "then publish it to the project issue tracker." The Spec is a Markdown file in `docs/specs/`; do not publish it as an issue and apply no triage label to it.
- **to-tickets.** Overrides "Ask the user:" and "Iterate until the user approves the breakdown." Publish the breakdown without the quiz; the tracker comes from `docs/agents/issue-tracker.md`.
- **implement-spec.** Build runs inline in the Run worktree, on its branch, one commit per Ticket, in dependency order. Overrides "Use an **exploration subagent**" and "Use **implementer subagents**" and "with a **merger subagent**" and "kick off more **implementer subagents**": create no subagents and merge nothing. Overrides "Create the integration branch.": the Run branch is the integration branch, and no Ticket worktrees or extra branches are made. Overrides "open a draft PR": Finish opens the only PR. Overrides "call the Skill tool with `code-review` on the integration branch": no closing review, Check owns it. Overrides "Clean up all **implementer subagent** worktrees.": nothing to clean up. Overrides "If a draft PR exists, mark it ready for review.": Finish owns the PR, and Ticket resolution is left to it through `Closes #N`.

## Define

1. Invoke `grill-with-docs` to settle what has to be done, starting from the work description the user gave with `/factory`; do not ask for it again. Update `GLOSSARY.md` and `docs/adr/` as it goes.
2. Invoke `to-spec` to write the Spec as a Markdown file in `docs/specs/`. Choose the test seams yourself and proceed without asking for seam confirmation or Spec sign-off.
3. Invoke `to-tickets` to cut the Spec into Tickets, published to the Issue tracker named in `docs/agents/issue-tracker.md`, local Markdown when that file names no tracker. Choose the breakdown and publish it without asking the user to review or approve it. If a label the tracker needs does not exist, ask the user before creating it.

## Build

Build only starts when `tds-factory run transition --id <id> --to build` succeeds, which needs the Spec file named in `spec_link` and a non-empty `tickets`. If it refuses, do not build: say what is missing and continue Define from there.

Work in the Run worktree, on its branch, and commit the Define artifacts first. If the verify command fails for missing dependencies, run the project's normal setup in the worktree. Invoke `implement-spec`, working test-first (Invoke `tdd`), with one commit per Ticket, until every Ticket is done. Build what the Ticket asks; if a smaller option exists, name it in one line in `build.md`. After each Ticket, raise `tickets_done`, run `tds-factory run verify --id <id>` and fix failures before moving on. List any command that cannot run in this environment (other shell, no container runtime) under "Not run" in `build.md` or `check-N.md`, and never report it as passed. The Build agent works inline and creates no subagents. Skip the closing `code-review` step of `implement-spec`; Check owns the review. When every Ticket is done, run `tds-factory run sync --id <id>` so Check reviews the code on top of the current default branch, then move on with `run transition --to check`.

## Check

Commit everything, then run `tds-factory run verify --id <id>`. In one pass, review those committed changes on four axes, each in its own fresh read-only subagent so the reviewer did not write the code. Report each axis separately and never merge them. If a fresh read-only reviewer for an axis cannot be started, do not review that axis yourself and record no verdict for it: set the Run to `verification-unavailable` with a `status_reason` naming the axis, and tell the user. Resume with `status` `running` only once a reviewer is available. Run every axis on every Run; Infrastructure is the one that may be `skipped`.

Invoke `code-review` for the Standards and Spec axes; it runs one subagent for each. Invoke `security-scan` for the Security axis, in a third subagent. Scope `security-scan` to the files in the same diff `code-review` uses. Give the Standards subagent every instruction guide from `conventions` whose `applyTo` globs match the changed files, and have it flag a change that leaves the canonical spec for that area stale when the changed behavior is documented there: a stale canonical spec is a Standards finding worth fixing. Give the Security subagent the project's "Universal safeguards" text from the conventions file, to check explicitly next to the generic patterns. A project with no guides or safeguards is reviewed as before.

The Infrastructure axis runs in a fourth fresh read-only subagent, with no new Skill, when the diff changes `*.bicep`, `*.bicepparam`, `bicepconfig.json`, files under `Pipelines/`, `azure-pipelines*.yml` or `*.pipeline.yml`; otherwise record `skipped` with `run verdict`. It runs `bicep build` and `bicep lint` with the project's `bicepconfig.json`. If private modules cannot be restored, it reports "not validated" with the reason and the verdict is `fail`, never `pass`. It runs a what-if only when Azure credentials and a documented target exist, and it must never deploy; a what-if that is not run because credentials or a target are missing is reported as not run. It checks changed pipeline YAML for plaintext secrets, unpinned task or template versions and missing approval gates on production stages, and checks the project's stated invariants (for example no Blob soft delete).

Record each axis result with `tds-factory run verdict`. An axis with no verdict in `run.json` after the pass is a problem worth fixing: run that axis again. Other problems worth fixing are the `code-review` findings you judge worth fixing, plus every CRITICAL, HIGH or MEDIUM security or infrastructure finding; LOW and INFO findings are only reported. If there are problems worth fixing, go back to Build with `tds-factory run rework --id <id>` and fix them (the security report only proposes patches; Build applies them), then verify and review again; the review of an earlier head no longer counts. All axes share one loop count: go back at most 4 times.

Only a clean Check continues to Finish without asking, and `run transition --to finish` refuses anything else. A Check is clean when every axis verdict is `pass`, with Infrastructure allowed to be `skipped`, the verdicts and a passing Verify result are all recorded for the current head, and the worktree has no uncommitted changes; an axis with no verdict, or a changed infrastructure file that is not validated, counts as `fail`. When Check would otherwise move on (no problem worth fixing is left, or the loop cap is reached) but the Check is not clean or problems worth fixing are still open, report what is still open, set the Run to `waiting` with a `waiting_reason` and ask the user for permission to continue to Finish, listing the open axes and findings. Continue only after an explicit yes: set the Run back to `running`, record the decision with `tds-factory run accept` (the open findings and the decision) and in `finish.md`, then move on. New commits void the accepted decision. On a no, or if the user tells you to stop, set `status` to `abandoned`.

## Finish

Start with `tds-factory run transition --id <id> --to finish`. Invoke `pr` to prepare the pull request. If the project has a PR template at `.github/pull_request_template.md`, `.azuredevops/pull_request_template.md` or `docs/pull_request_template.md`, pass it to `pr` and fill it in, including its Infrastructure checklist from the `infrastructure` verdict and its Documentation checklist from the stale-spec check; otherwise keep the layout `pr` produces. Then Invoke `unslop` on the PR title and the prose of the body, and leave diagrams, diffs, code blocks, Evidence output and the template's bold labels as they are. Save the cleaned draft as plain Markdown in `pr.md` in the Run folder. When the tracker is GitHub, the PR body lists `Closes #N` for every Ticket; otherwise it lists the Ticket paths and has no `Closes` lines. Push the branch and open the PR. When the PR is handled, run `tds-factory run complete --id <id>` after setting `pr`. Once the user has the PR merged, `tds-factory run clean --id <id>` from the main checkout removes the Run worktree and branch; never run it from inside the worktree.
