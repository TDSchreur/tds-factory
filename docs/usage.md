# Use the Factory

This guide walks through one piece of work, from the first message to the merged pull request. Install the Factory first: [install guide](install.md). The examples use GitHub Copilot; Claude Code and Codex work the same way once the agent has found the skill.

## The Flow in one picture

```mermaid
flowchart TB
    start(["You: /factory and a description"]) --> pre["Preflight: the Doctor checks, conventions and Verify command (asks you if it is missing)"]
    pre --> define["Define: interview (you answer and confirm), Spec, Tickets"]
    define --> build["Build: each Ticket test-first, one commit each"]
    build --> check["Check: Standards, Spec, Security, Infrastructure"]
    check -->|"problems worth fixing, at most 2 times"| build
    check -->|"clean"| finish["Finish: push the branch, open the pull request"]
    check -.->|"not clean: you decide"| finish
    finish --> review(["You: review and merge"])
```

The Run waits for you in Define, in Preflight when the Verify command is missing, and at the dotted line from Check.

Define is where the agent needs you most. After that it works on its own and stops only for a missing label or a Check that is not clean (see part 4).

## 1. Start a Run

Before the first Run in a project, check that it is ready. From the project folder:

```sh
tds-factory doctor
```

It changes nothing and prints one line per check, such as `pass    git: origin default branch is master`. Fix every line that says `missing` or `fail` first; `/factory` runs the same checks and stops when one fails. See "Check readiness without starting a Run" below for what it checks.

Open your prepared project (see part 5 of the [install guide](install.md)) in your agent and start a new chat. Describe the work in the same message that starts the skill:

```text
/factory Add a CSV export button to the reports page
```

In Copilot in VS Code, type `/`, choose `factory`, and write the description after it. In Claude Code, type `/factory` and the description. In other agents, choose `factory` from the agent's own list of skills and write the description in the same message. In Copilot in VS Code and in Claude Code the agent never starts `factory` on its own; Codex may.

Start with a small task the first time. Good first tasks change one thing and are easy to check, such as a new button, a validation rule or a missing test.

The agent first runs `tds-factory doctor` and, if something is missing, stops and tells you which part. Then it starts a Run (if the project has no verify command yet, it asks you for one, see part 4): it makes a git worktree in `.factory/worktrees/<run id>` on its own branch and does all the work there. Your own checkout is never touched, so you can keep working in it, and you can run several Runs side by side.

```mermaid
flowchart TB
    main["Your checkout (never touched)"]
    store[".factory/runs/RUN-ID/: run.json and the Stage summaries"]
    tree[".factory/worktrees/RUN-ID/: the Run worktree on its own branch"]
    dash["tds-factory dashboard"]
    main --- store
    main --- tree
    tree -->|"agent works and commits here"| branch["Run branch, then the pull request"]
    store -->|"read every 2 seconds"| dash
```

## 2. Define: answer the questions

The agent interviews you to settle what has to be done. It asks in rounds. Each question is numbered and comes with the answer the agent recommends, written so that "yes" accepts it. An example:

```text
Q1 - Format: export plain CSV, not Excel?
-> Yes, plain CSV. It opens in Excel and needs no library.
```

- Answer a question by number. "Yes to all" accepts every recommendation in the round.
- Say so when you disagree. The agent changes the plan and asks the next round.
- The agent may update `GLOSSARY.md` and add a decision record in `docs/adr/` while you talk. Those are normal files and show up in the pull request.
- When nothing is left to ask, the agent tells you what it understood and waits for you to confirm. Read that summary carefully. Changes are cheap now and expensive after Build.

The agent then writes a Spec in `docs/specs/`, and cuts it into Tickets in GitHub Issues, without asking you to approve either. Each Ticket is a small slice that can be built and checked alone.

## 3. What happens without you

- **Build:** the agent writes a failing test, makes it pass, runs the project's verify command and commits, one Ticket at a time.
- **Check:** the Factory asks for up to four reviews to run separately (three when no infrastructure file changed), each in a fresh read-only subagent that did not write the code. How your agent runs subagents is up to the agent; the Factory does not control it. Standards: does the code follow the project's rules. Spec: does it do what the Spec asked. Security: does it introduce a vulnerability. Infrastructure: are Bicep and pipeline files valid (skipped when none changed). Problems worth fixing send the Run back to Build, at most twice.
- **Finish:** the agent writes the pull request, pushes the branch and opens it. Its description lists `Closes #N` for every Ticket.

Most Stages leave a short summary in `.factory/runs/<run id>/`: `define.md`, `build.md`, `check-1.md` (one per Check pass), `finish.md` and the pull request text in `pr.md`. `run.json` in the same folder is the status file the Dashboard reads. Read the summaries when you want to know what was decided.

## 4. When the Run needs you

A Run stops and asks you in these cases:

1. **During Define,** with questions or to confirm the shared understanding.
2. **At the start,** if the project has no verify command (see below). **Before Build,** if a label the Tickets need does not exist: the agent asks before it creates the label.
3. **After Check,** when a review still fails or problems are still open after two rounds of fixes. The agent lists the open findings and asks permission to continue. Say yes to open the pull request anyway (your decision is recorded in the Run and in `finish.md`, and only holds for the code as it is then; new commits void it), or no to abandon the Run.

A Run's `status` moves like this:

```mermaid
stateDiagram-v2
    [*] --> running
    running --> waiting: the Run needs your answer
    waiting --> running: you answer
    running --> verification_unavailable: a check cannot run
    running --> interrupted: the agent was interrupted
    verification_unavailable --> running: resumed
    interrupted --> running: resumed
    running --> done: pull request handled
    running --> abandoned: you stop it
    waiting --> abandoned: you say no
    verification_unavailable --> abandoned: you stop it
    interrupted --> abandoned: you stop it
    done --> [*]
    abandoned --> [*]
```

(`verification_unavailable` is `verification-unavailable` in `run.json`; Mermaid does not allow the hyphen.)

The same moment shows on the Dashboard as a red card marked "Needs you" and a number in the browser tab title. Answer in the chat where the agent is waiting.

If the project does not have a verify command in `AGENTS.md` (or `CLAUDE.md`) under `## Commands`, the agent asks for it once, at the very start of the Run, and records it. The command cannot be changed later; start a new Run for that. The Run shows as "Needs you" while it waits.

## 5. Follow Runs on the Dashboard

Start the Dashboard from the project folder:

```sh
tds-factory dashboard
```

It prints an address such as `http://127.0.0.1:4521`. Each repository gets its own port, and normally keeps it; if that port is busy, the Dashboard takes a free one and prints it. Open the address in a browser.

- Each **card** is one Run. It moves left to right through the columns Define, Build, Check, Finish and Done.
- The **chips** show the Ticket progress, the four Check verdicts (pass, fail, skipped) and how many times Check sent the Run back to Build.
- A card marked **Needs you** is waiting for your answer. **Verification unavailable** means the check could not run; **Agent interrupted** means the Run needs explicit resumption. Both cards show the reason.
- Click a card to open the **Run detail** on the right: its links, Tickets and the Stage summaries. Click the card again, press Esc or use the close button to close it.
- Done cards start collapsed. Press **Show details** on a Done card to see its pull request link and actions. **Merge** appears while the pull request is open and squash-merges it after you confirm. **Delete** is available on every Run. Stop an unfinished Run's agent first. Delete removes its record and Factory-created worktree while keeping the branch. If the worktree has uncommitted changes, a separate confirmation lets you discard them or cancel. **Delete all** applies only to Done Runs and asks separately about each dirty worktree.
- Older Runs are folded away; "Show older" brings them back.

Leave the Dashboard open while you work. It refreshes every two seconds. The routes and the rules for deleting a Run are in the [Dashboard guide](dashboard.md).

## 6. Stop or redirect a Run

- **Stop:** tell the agent to stop. The Run is marked abandoned and stays on the Dashboard until you delete it.
- **Redirect:** tell the agent what to change in the chat. During Define it changes the plan. During Build or Check, ask for the change and expect it to be made in the Run worktree, on the Run branch.
- **Start over:** abandon the Run and start `/factory` again with a better description.

## 7. Review and merge the pull request

The agent opens the pull request but does not merge it. Before you merge:

1. Read the **Summary**: does it match what you asked for?
2. Read **Evidence**: which tests failed before and pass now.
3. Read **Merge Danger**: whether the change is easy to undo, and what it can break.
4. Open `check-1.md` (or the highest `check-N.md`) in the Run folder to see the four verdicts and any finding left open.
5. Look at the diff yourself, like any other pull request.

Merge in GitHub, or press **Merge** on the Dashboard card. The `Closes #N` lines close the Tickets. Maintainers who publish the merged work as a Release follow the [release guide](releasing.md).

## Words you will see

| Word | Meaning |
|---|---|
| Run | One pass of the Flow for one piece of work, from idea to pull request. One card on the Dashboard. |
| Stage | One step of the Flow: Define, Build, Check or Finish. |
| Spec | The written definition of what to build, a Markdown file in `docs/specs/`. |
| Ticket | One small unit of work cut from the Spec, an issue in GitHub. |
| Check axis | One of the independent reviews in Check: Standards, Spec, Security, Infrastructure. |
| Clean | A Check where every axis passes (Infrastructure may be skipped) and the verify command passed, all for the current code with nothing uncommitted. Only a clean Check goes on without asking you. |
| Doctor | The read-only `tds-factory doctor` command that checks whether a project is ready for a Run. |
| Run worktree | The git worktree and branch a Run works in, so Runs never share files. |
| Run detail | The panel on the Dashboard that shows a Run's links, Tickets and Stage summaries. |

The full list is in [GLOSSARY.md](../GLOSSARY.md). What each Agent target guarantees, such as how read-only the Check agents are, is in the [capability matrix](capabilities.md). To test an agent against the Flow, see the [agent evaluation](evaluation.md).

## Check readiness without starting a Run

Run `tds-factory doctor [--agent claude|codex|copilot] [--json]` in the project. It changes nothing and reports `pass`, `missing` or `fail` for the CLI version, the required Skills, the tracker setup, the Git `origin` and its default branch, the review capabilities (the review Skills and the read-only `factory-check` agent) and the verify command. It exits with 1 until every check passes. `/factory` runs it first; a missing verify command is the one thing the agent asks you for, and a Run without a usable one cannot enter Build, Check or Finish.

## Recover a Run

Run `tds-factory run inspect --id ID` to diagnose its lock, worktree and stale Evidence. `tds-factory run repair --id ID` prints a proposal without changing anything. Review it, then add `--apply` to apply the safe changes. Repair checks the Run branch and GitHub PR before suggesting changes, keeps dirty worktrees, and reconstructs a missing record as interrupted. It clears only a lock whose local owner is known to have exited; age never expires a lock. An unknown or foreign owner must be investigated manually. A leftover repair coordination lock is also reported for manual investigation.
