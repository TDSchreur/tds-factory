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
One step of the Flow: Define, Build, Check, Finish or Follow-up.
_Avoid_: Phase, step

**Track**:
The weight of the Flow a Run uses, either Fast or Full. The user chooses it in Define, or confirms Define's recommendation; it is never applied silently. A Run with no recorded track is a Full track Run.
_Avoid_: Mode, Lane

**Fast track**:
The lighter Track for bug fixes and tiny changes: one confirmation in Define, a one-paragraph Spec, a single Ticket, and Check keeping at least Standards and Security. Only a clean Check goes on to Finish without asking, as on the Full track.

**Full track**:
The default Track: the full Define interview, a Spec and as many Tickets as the work needs.

**Follow-up**:
The Stage after Finish that observes the Run's pull request and scopes Rework to failing checks and unresolved review comments. It is entered explicitly and can reopen a delivered Run.

**Done**:
A Run that has delivered its current revision for review or whose pull request has merged. Done ends the current work; explicit Follow-up may resume observation of an open pull request.

**Preflight**:
The checks before the first Stage: project setup and Conventions, run with the Doctor. Not a Stage.

**Check axis**:
One of the independent reviews in the Check Stage, each reporting its own verdict. Standards, Spec, Security and Infrastructure are the Factory's baseline axes; a Project review is an additional axis.
_Avoid_: Reviewer, Gate

**Project review**:
An additional Check axis supplied by a project through a Skill, alongside the Factory's baseline reviews. Its Blocking findings can send a Run back to Build for Rework.

**Doctor**:
The read-only `tds-factory doctor` command that runs the Preflight checks and reports each as `pass`, `missing` or `fail`. The shared checks (CLI version, tracker setup, Git origin and default branch, Verify command and the optional Verify-fast command) are reported once; the per-Agent-target checks (binary, required Skills, Project config, review capabilities) are reported for each Agent target. It may add non-blocking notes, such as merged Runs that still hold a worktree.
_Avoid_: Linter, Health check

**Usable agent**:
An Agent target whose command is found on PATH and whose per-target Doctor checks all pass. Without `--agent`, the Doctor needs at least one usable Agent target; the others may be missing. Named with `--agent`, a target is held to its Skills, Project config and review checks alone, because the caller already runs inside it.

**Project config**:
The optional committed `.factory/config.json` with a project's settings: the model per Stage, the Check loop cap (at most the Factory maximum), the Ticket label and extra Project reviews. A Run freezes it when it starts, and the Doctor validates it.
_Avoid_: Settings file

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

**Session token**:
The random value a Dashboard server makes when it starts. The Dashboard page reads it from `/api/info` and sends it with every write, so a request from another web page, which cannot read it, is refused. See ADR 0017.

**Verify command**:
The project's own command for checking that the code works, found in the `## Commands` section of its conventions file during Preflight and run in full after the last Ticket, after Run sync and before every Check pass.
_Avoid_: Test command

**Fast verify command**:
The project's optional quicker check, a `Verify-fast:` line in the same `## Commands` section, run after each Ticket with `tds-factory run verify --fast`. Its result is quick feedback only: it is never Evidence and the Verify command still has to pass for the current code before Check and Finish.
_Avoid_: Quick test

**Verify result**:
The recorded outcome of running the Verify command in a Run worktree: which code revision it ran on, whether it passed, and when. It only counts as evidence while the Run worktree is still at that revision and had no uncommitted changes.

**Evidence**:
The Verify result and the Check axis verdicts of a Run, each tied to the code revision it was produced for. Evidence goes stale when new commits land after it was recorded, except for a Carried-over verdict.
_Avoid_: Proof

**Carried-over verdict**:
A Security or Infrastructure verdict that a Rework keeps for the new code revision instead of a new review, recorded with `tds-factory run verdict --carried`. The command allows it only after a text-only Rework: the axis had the same verdict (`pass`, or `skipped` for Infrastructure) on an earlier revision that is still an ancestor of the current one, the worktree is clean, and every change since is a plain file on an allowlist of documents (Markdown in `docs/`, changelog fragments, README, GLOSSARY, CONTRIBUTING, SECURITY). A rename counts as both of its paths, and anything an agent could load as instructions never qualifies: hidden files and folders, folders named agents, skills, commands, prompts or instructions at any depth, and instruction file names (`AGENTS.md`, `CLAUDE.md`, `SKILL.md` and the like). It records the revision the verdict was carried from. Standards and Spec are always reviewed again.
_Avoid_: Skipped review, Reused verdict

**Accepted Check**:
A Check that is not clean but that the user has explicitly allowed to continue to Finish, together with the open findings and the decision. It applies to one code revision only.

**Invocation contract**:
What the Factory relies on from a Skill it invokes: the `## Invoked Skills` section of the `factory` Skill, which overrides upstream steps that conflict with the Flow (publishing the Spec as an issue, seam and breakdown sign-off, subagent Build, a closing review).
_Avoid_: Wrapper, Patch

**Capability matrix**:
The per-Agent-target table in `docs/capabilities.md` of how Skills and Stage agents are invoked, how far review is isolated, how a Run resumes and what happens when an independent reviewer is unavailable.

**Term sweep**:
The read-only `tds-factory run sweep` command, step one of the Exit checklist: it lists every place in the documents that still holds a term the Run's diff changed, plus the older wordings you add with `--term`, so a stale statement is found while building. Hits in documents marked as replaced are shown apart. It judges nothing.
_Avoid_: Grep pass

**Exit checklist**:
The inline steps Build runs after the last Ticket and after every Rework, before moving on: a term sweep (`tds-factory run sweep`), the required artifacts, a story trace, a security check and a self-check of its own diff. It records no verdict or Evidence; Check still owns the review.
_Avoid_: Self-review

**Blocking finding**:
A finding of a Check axis that sends a Run back to Build: a violation of a documented standard that names the rule (a stale statement in a document that describes current behavior counts), a CRITICAL, HIGH or MEDIUM security, infrastructure or Project review finding, or a Spec requirement that is missing or wrong. A security, infrastructure or Project review finding of that severity blocks whatever its basis. The reviewer gives every finding a severity and the standard or requirement it breaks; code smells and style judgement are never above LOW.
_Avoid_: Blocker, Problem worth fixing

**Left open**:
A finding that is not a Blocking finding (LOW, INFO, a code smell or style judgement). It is listed in `check-N.md`, `finish.md` and the pull request description, and never causes a Rework or stops a Clean Check.

**Rework**:
Sending a Run back from Check or Follow-up to Build to fix Blocking findings or Follow-up feedback. Each Rework counts against the same loop limit and makes the earlier Evidence stale.
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

**Run metrics**:
Observed Stage time, Reworks and Check history for a Run. Missing observations are unknown rather than zero.

**Stage visit**:
One continuous stay in a Stage, including time waiting for a human. Rework starts another Build visit and can lead to another Check visit.

**First-pass clean rate**:
The proportion of observed first Check outcomes that reach Finish clean without Rework. Rework and an Accepted nonclean Finish count as unsuccessful outcomes; unfinished and unknown outcomes are excluded.

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
A script attached to every Release (`install.sh` for macOS and Linux, `install.ps1` for Windows, PowerShell 7) that a new user pipes into a shell to get the Factory. It only checks Node and npm, installs the Release with npm and runs `tds-factory install`.
_Avoid_: Setup script
