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
One of the independent reviews in the Check Stage (Standards, Spec, Security, Infrastructure), each reporting its own verdict. Infrastructure may be skipped when no infrastructure file changed, and is the only one that blocks Finish.
_Avoid_: Reviewer, Gate

**Verify command**:
The project's own command for checking that the code works, found in the `## Commands` section of its conventions file during Preflight and run after each Ticket.
_Avoid_: Test command

**Conventions**:
The project's own rules: `AGENTS.md` or `CLAUDE.md`, the instruction guides it routes to and the canonical specs it lists, read at Preflight and given to the Standards and Security axes.
_Avoid_: Standards

**Spec**:
The written definition of what to build, kept as a Markdown file in the repo under `docs/specs/`.

**Ticket**:
One unit of work cut from a Spec, stored in the project's Issue tracker.
_Avoid_: Task, story

**Run**:
One pass of the Flow for one piece of work, from idea to pull request.
_Avoid_: Job, Pipeline

**Run record**:
The status file a Run keeps up to date as it moves through the Stages, read by the Dashboard.
_Avoid_: Log, State file

**Dashboard**:
A read-only web page that shows every Run as a card in a column per Stage, and flags the Runs that are waiting on a human.
_Avoid_: Board, Monitor
