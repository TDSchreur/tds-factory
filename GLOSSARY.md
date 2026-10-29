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
One step of the Flow: Define, Prepare, Build, Check or Finish.
_Avoid_: Phase, step

**Preflight**:
The checks before the first Stage: project setup and Conventions. Not a Stage.

**Check axis**:
One of the independent reviews in the Check Stage (Standards, Spec, Security, Infrastructure), each reporting its own verdict. Infrastructure may be skipped when no infrastructure file changed.
_Avoid_: Reviewer, Gate

**Clean**:
A Check whose every Check axis is `pass`, with Infrastructure allowed to be `skipped`, backed by current Evidence: a passing Verify result and every verdict recorded for the code as it is now, with nothing uncommitted. Only a clean Check continues to Finish without asking the user.

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

**Run detail**:
The side panel the Dashboard opens beside the board when a Run's card is selected, showing its status, links and Stage summaries.
_Avoid_: Ticket (a Ticket is a unit of work cut from a Spec, not what you click), Modal

**Release**:
A packaged build of the Factory published on GitHub when a maintainer chooses to release changes. Colleagues install the latest Release with one command.
_Avoid_: Package, Distribution
