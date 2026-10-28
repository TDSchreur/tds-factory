# Use the Factory

This guide walks through one piece of work, from the first message to the merged pull request. Install the Factory first: [install guide](install.md). The examples use GitHub Copilot; Claude Code and Codex work the same way once the agent has found the skill.

## The Flow in one picture

```text
you describe the work
  Define    the agent interviews you, writes a Spec and cuts it into Tickets   (you answer)
  Prepare   the agent switches to the minimal-code working style
  Build     the agent implements each Ticket test-first, one commit each
  Check     four independent reviews: Standards, Spec, Security, Infrastructure
  Finish    the agent pushes the branch and opens the pull request              (you review and merge)
```

Define is where the agent needs you most. After that it works on its own and stops only for a missing label or a Check that is not clean (see part 4).

## 1. Start a Run

Open your prepared project (see part 5 of the [install guide](install.md)) in your agent and start a new chat. Describe the work in the same message that starts the skill:

```text
/factory Add a CSV export button to the reports page
```

In Copilot in VS Code, type `/`, choose `factory`, and write the description after it. In Claude Code, type `/factory` and the description. In other agents, choose `factory` from the agent's own list of skills and write the description in the same message. In Copilot in VS Code and in Claude Code the agent never starts `factory` on its own; Codex may.

Start with a small task the first time. Good first tasks change one thing and are easy to check, such as a new button, a validation rule or a missing test.

The agent first checks that the project is ready: the setup files exist, `tds-factory` runs, and it knows the command that verifies the project. If something is missing it stops and tells you which part. Then it starts a Run: it makes a git worktree in `.factory/worktrees/<run id>` on its own branch and does all the work there. Your own checkout is never touched, so you can keep working in it, and you can run several Runs side by side.

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

- **Prepare:** the agent switches to building only what each Ticket asks for.
- **Build:** the agent writes a failing test, makes it pass, runs the project's verify command and commits, one Ticket at a time.
- **Check:** the Factory asks for four reviews to run separately, each in a fresh read-only subagent that did not write the code. How your agent runs subagents is up to the agent; the Factory does not control it. Standards: does the code follow the project's rules. Spec: does it do what the Spec asked. Security: does it introduce a vulnerability. Infrastructure: are Bicep and pipeline files valid (skipped when none changed). Problems worth fixing send the Run back to Build, at most twice.
- **Finish:** the agent writes the pull request, pushes the branch and opens it. Its description lists `Closes #N` for every Ticket.

Most Stages leave a short summary in `.factory/runs/<run id>/`: `define.md`, `build.md`, `check-1.md` (one per Check pass), `finish.md` and the pull request text in `pr.md`. Prepare leaves none. `run.json` in the same folder is the status file the Dashboard reads. Read the summaries when you want to know what was decided.

## 4. When the Run needs you

A Run stops and asks you in these cases:

1. **During Define,** with questions or to confirm the shared understanding.
2. **At the start,** if the project has no verify command (see below). **Before Build,** if a label the Tickets need does not exist: the agent asks before it creates the label.
3. **After Check,** when a review still fails or problems are still open after two rounds of fixes. The agent lists the open findings and asks permission to continue. Say yes to open the pull request anyway (your decision is recorded in `finish.md`), or no to abandon the Run.

The same moment shows on the Dashboard as a red card marked "Needs you" and a number in the browser tab title. Answer in the chat where the agent is waiting.

If the project does not have a verify command in `AGENTS.md` (or `CLAUDE.md`) under `## Commands`, the agent asks for it once, at the very start of the Run, and records it. The Run shows as "Needs you" while it waits.

## 5. Follow Runs on the Dashboard

Start the Dashboard from the project folder:

```sh
tds-factory dashboard
```

It prints an address such as `http://127.0.0.1:4521`. Each repository gets its own port, and normally keeps it; if that port is busy, the Dashboard takes a free one and prints it. Open the address in a browser.

- Each **card** is one Run. It moves left to right through the columns Define, Prepare, Build, Check, Finish and Done.
- The **chips** show the Ticket progress, the four Check verdicts (pass, fail, skipped) and how many times Check sent the Run back to Build.
- A card marked **Needs you** is waiting for your answer.
- Click a card to open the **Run detail** on the right: its links, Tickets and the Stage summaries. Click the card again, press Esc or use the close button to close it.
- Done cards start collapsed. Press **Show details** on a Done card to see its pull request link, **Merge** and **Delete**. **Merge** appears while the pull request is open and squash-merges it after you confirm. **Delete** removes the Run record and its worktree, and refuses if the worktree has uncommitted changes. Branches are never deleted.
- Older Runs are folded away; "Show older" brings them back.

Leave the Dashboard open while you work. It refreshes every two seconds.

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

Merge in GitHub, or press **Merge** on the Dashboard card. The `Closes #N` lines close the Tickets.

## Words you will see

| Word | Meaning |
|---|---|
| Run | One pass of the Flow for one piece of work, from idea to pull request. One card on the Dashboard. |
| Stage | One step of the Flow: Define, Prepare, Build, Check or Finish. |
| Spec | The written definition of what to build, a Markdown file in `docs/specs/`. |
| Ticket | One small unit of work cut from the Spec, an issue in GitHub. |
| Check axis | One of the independent reviews in Check: Standards, Spec, Security, Infrastructure. |
| Clean | A Check where every axis passes (Infrastructure may be skipped). Only a clean Check goes on without asking you. |
| Run worktree | The git worktree and branch a Run works in, so Runs never share files. |
| Run detail | The panel on the Dashboard that shows a Run's links, Tickets and Stage summaries. |

The full list is in [GLOSSARY.md](../GLOSSARY.md).
