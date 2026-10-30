# TDS Factory

A simple software factory: a curated set of skills, installed into coding agents, that walks a piece of work from idea to pull request.

## Language

**Factory**:
The curated set of skills plus the installer that puts them into agents.
_Avoid_: Pipeline, orchestrator

**Skill**:
A folder with a `SKILL.md` that teaches an agent one capability.

**Agent target**:
A coding agent the factory installs skills into: Claude, Codex or Copilot.
_Avoid_: Backend, platform

**Flow**:
The ordered Stages a piece of work moves through, encoded in the `factory` Skill.

**Stage**:
One step of the Flow: Define, Build, Check or Finish.
_Avoid_: Phase, step

**Preflight**:
The checks before the first Stage: project setup and Conventions, run with the Doctor. Not a Stage.

**Check axis**:
One of the independent reviews in the Check Stage, each reporting its own verdict. Standards, Spec, Security and Infrastructure are the Factory's baseline axes; a Project review is an additional axis.
_Avoid_: Reviewer, Gate

**Project review**:
An additional Check axis supplied by a project through a Skill, alongside the Factory's baseline reviews. Its findings can send a Run back to Build for Rework.

**Doctor**:
The read-only `tds-factory doctor` command that runs the Preflight checks (CLI version, required Skills, tracker setup, Git origin and default branch, review capabilities, Verify command) and reports each as `pass`, `missing` or `fail`. It may add non-blocking notes, such as merged Runs that still hold a worktree.
_Avoid_: Linter, Health check

**Run sync**:
The `tds-factory run sync` command, which rebases a Run branch onto the current default branch of `origin` so conflicts surface during the Run. Finish refuses a branch that would not merge cleanly.
_Avoid_: Sync (alone), which is the maintainer command `tds-factory sync`

**Changelog fragment**:
A file in `changelog.d/` that holds the changelog entries of one change. A maintainer folds the fragments into `CHANGELOG.md` at release time, so PRs never edit the same lines.

**Run clean-up**:
The `tds-factory run clean` command, which removes the worktree and local branch of a Run whose PR is merged and keeps its Run record. Not to be confused with a clean Check.
_Avoid_: Clean (alone)

**Clean**:
A Check whose every Check axis is `pass`, with Infrastructure and nonmatching Project reviews allowed to be `skipped`, backed by current Evidence: a passing Verify result and every verdict recorded for the code as it is now, with nothing uncommitted. Only a clean Check continues to Finish without asking the user.

**Verify command**:
The project's own command for checking that the code works, found in the `## Commands` section of its conventions file during Preflight and run after each Ticket.
_Avoid_: Test command

**Verify result**:
The recorded outcome of running the Verify command in a Run worktree: which code revision it ran on, whether it passed, and when. It only counts as evidence while the Run worktree is still at that revision and had no uncommitted changes.

**Evidence**:
The Verify result and the Check axis verdicts of a Run, each tied to the code revision it was produced for. Evidence goes stale when new commits land after it was recorded.
_Avoid_: Proof

**Accepted Check**:
A Check that is not clean but that the user has explicitly allowed to continue to Finish, together with the open findings and the decision. It applies to one code revision only.

**Invocation contract**:
What the Factory relies on from a Skill it invokes: the `## Invoked Skills` section of the `factory` Skill, which overrides upstream steps that conflict with the Flow (publishing the Spec as an issue, seam and breakdown sign-off, subagent Build, a closing review).
_Avoid_: Wrapper, Patch

**Capability matrix**:
The per-Agent-target table in `docs/capabilities.md` of how Skills and Stage agents are invoked, how far review is isolated, how a Run resumes and what happens when an independent reviewer is unavailable.

**Rework**:
Sending a Run back from Check to Build to fix problems. Each Rework counts against the loop limit and makes the earlier Evidence stale.
_Avoid_: Retry, Loop back

**Conventions**:
The project's own rules: `AGENTS.md` or `CLAUDE.md`, the instruction guides it routes to and the canonical specs it lists, read at Preflight and given to the Standards and Security axes.
_Avoid_: Standards

**Spec**:
The written definition of what to build, kept as a Markdown file in the repo under `docs/specs/` while the work is in flight, and moved to `docs/specs/archive/` once it has shipped.

**Ticket**:
One unit of work cut from a Spec, stored in the project's Issue tracker.
_Avoid_: Task, story

**Run**:
One pass of the Flow for one piece of work, from idea to pull request.
_Avoid_: Job, Pipeline

**Run record**:
The status file a Run keeps up to date as it moves through the Stages, read by the Dashboard.
_Avoid_: Log, State file

**Run store**:
The single owner of every Run record and Run folder; the CLI and the Dashboard go through it.
_Avoid_: Run database

**Run repair**:
An explicit, reviewed reconciliation of a Run with its existing git and GitHub work, preserving unfinished changes and restoring only facts that can be established.
_Avoid_: Restart, Automatic recovery

**Run worktree**:
The git worktree and branch a Run works in, so agents running at the same time never share files. One Run has exactly one agent and one Run worktree.
_Avoid_: Sandbox, Workspace

**Dashboard**:
A local web page that shows every Run as a card in a column per Stage and flags the Runs waiting on a human.
_Avoid_: Board, Monitor

**Factory version**:
The version of the Factory installation serving a Dashboard, independent of the project or its Runs.

**Run detail**:
The panel the Dashboard opens when a Run's card is selected, showing its status, links and Stage summaries.
_Avoid_: Ticket (a Ticket is a unit of work cut from a Spec, not what you click), Modal

**Release**:
A packaged build of the Factory published on GitHub when a maintainer chooses to release changes. Colleagues install the latest Release with one command.
_Avoid_: Package, Distribution

**Update**:
The `tds-factory update` command: it installs the latest Release when the installed version is older and never downgrades, then refreshes the Skills and Stage agents so they match the CLI.
_Avoid_: Upgrade, Self-update

**Bootstrap installer**:
A script attached to every Release (`install.sh` for macOS and Linux, `install.ps1` for Windows) that a new user pipes into a shell to get the Factory. It only checks Node and npm, installs the Release with npm and runs `tds-factory install`.
_Avoid_: Setup script
