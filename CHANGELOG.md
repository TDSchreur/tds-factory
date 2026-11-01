# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.1] - 2026-11-01

### Added
- `npm run check` runs lint, format check and typecheck in one go; an `.editorconfig` matches the Prettier settings.
- `tds-factory run rework --cause <cause>` records why Check sent a Run back to Build (`stale-doc`, `test-gap`, `spec-gap`, `security`, `bug`, `size` or `other`; repeatable). `run stats --id`, `run stats --all` and the Dashboard Run detail count the causes; a Rework without a cause, and older records, count as unknown.
- `tds-factory run sweep` ends with the list of documents still to read (the ones the Run did not change, most hits first), and `--files` prints only that list. The Exit checklist now asks for the whole output and a Sweep paragraph in `build.md`, and the Standards reviewer reads it.
- `tds-factory run sweep` also searches the command line help and the Dashboard help text and tags those hits as code, so a stale help line is found while building.
- `tds-factory run stats --id` shows the tokens a Run used per Stage, model and Ticket, read from the Claude session logs at each Stage change and at completion. The headline is fresh tokens (input plus cache write plus output); cache reads, reviewer subagents, the Build wrap-up and the Rework bucket are shown apart. A Run whose logs cannot be read says `not tracked`; only counts are stored, never conversation text.
- Token usage is also read for Runs on the Codex target, from the Codex session files. Cached input is shown as cache read, so Codex and Claude rows use the same four fields; subagent rollouts of the same session count in their Stage and model.
- Token usage is also read for Runs on the Copilot target, from the Copilot session event files. Cache reads and writes are taken out of Copilot's input count, so all three targets show the same four fields; calls made by sub-agents count in their Stage and model.
- The Dashboard shows token usage: Run detail has a table per Stage, model and Ticket with the same labels as `run stats`, and each Ticket on a card is a two-line tile with its fresh tokens and models (the active one says "so far"; hover or focus shows the breakdown). Work after a Rework has its own tile.
- `"usage": false` in `.factory/config.json` stops the Factory reading the agent session logs for token usage. It is on by default, frozen into each Run at start, and a value that is not `true` or `false` fails `doctor` with its line.
- `tds-factory run stats --all` adds the tokens per model over all Runs with tracked usage, and names the Runs that are left out of the totals.

### Changed
- Define names the concrete documents in the Spec's Documents bullet, found with the Sweep on the feature's key terms, and a Full track Run with three or more Tickets gets one last documentation Ticket blocked by all the others.
- Prettier now formats and checks JavaScript, JSON, Markdown and YAML across the repository, with the formatting commits listed in `.git-blame-ignore-revs`.
- ESLint also enforces `eqeqeq`, `prefer-const`, `no-var` and `no-shadow`.
- `tsconfig.json` covers every JavaScript folder; files opt in to typechecking with `// @ts-check`, and eleven more small modules now do.
- The Dashboard shows the facts of a Run (track, Tickets, Check verdicts and Check loops) as a list with an icon, a label and a value per row, in colour for pass, fail and skipped, so the facts are easier to tell apart.

### Fixed
- `tds-factory doctor` and `tds-factory run start` no longer hang for 20 seconds when origin needs a login that Git Credential Manager would ask for in a browser or dialog; the git check now fails at once, and a timeout says what to check.
- The Dashboard no longer shows `Merge: no conflicts` in the alert colour on the PR status. Only failing checks and a conflict with the base branch are red.
- Token usage now finds a Run whose id appears only at the start of a line inside a session log string (after an escaped newline, tab or carriage return), so such a session is no longer undercounted.

## [0.6.0] - 2026-11-01

### Added
- `tds-factory run verdict --axis security|infrastructure --value pass|skipped --carried` keeps an earlier Security or Infrastructure verdict for the current code, so those axes need no new review. The command allows it only after a text-only Rework (documents, never code, tests, Skills, agents or instruction files; see the glossary entry Carried-over verdict) and records the revision the verdict was carried from. Standards and Spec are always reviewed again (ADR 0019).
- The Dashboard shows the status of an Azure DevOps pull request (policies and build, merge conflicts, reviewers) in the same block as for GitHub, and the Done Stage and Clean up work for it. It reads through the `az` command and its `azure-devops` extension, read-only. An Azure DevOps pull request has no Merge button (the card says to merge it in Azure DevOps) and Follow-up does not support it yet. A missing `az`, extension or sign-in shows "status unavailable" with the fix.
- The Dashboard can grant one extra Check loop to a Run that waits on you in Check at its loop limit ("Grant extra loop", one loop per click, no ceiling). The grant is recorded as `extra_loops` in the Run record and in the Event log, raises the limit that `run rework`, Follow-up and the loop chip use, and has no command-line equivalent so that an agent cannot grant itself a loop. See ADR 0024.
- The Dashboard has a Help button that opens a short help panel on the Stages, the Fast and Full track, waiting on you, the Check verdicts and the actions. With no Runs it shows a welcome card that says how to start with `/factory`. The old collapsed "What is this?" line is gone.
- The Dashboard shows the status of a Run's open GitHub pull request on its card and in its detail, for every Stage that has a PR: checks (with the failing names), merge conflicts, review state and draft. The status is cached, never delays a poll, and shows "PR status unavailable" with a Check again button when `gh` cannot answer. `GET /api/runs/<id>/pr-status[?refresh=1]` returns it.
- The Dashboard shows progress: a Ticket progress bar, the requested or observed model, and a "last seen" that warns after 10 minutes of silence on each card, and an event timeline in the Run detail, with a note when the event log is damaged.
- The Dashboard shows a "Needs you" banner on a card that waits on you, with the reason and how long it has waited, a Needs you button that filters every Stage to those Runs, and puts waiting Runs first in each Stage.
- An optional `- Verify-fast: <command>` line under `## Commands` gives a Run a quicker check. Build runs it after each Ticket with `tds-factory run verify --id ID --fast`; its result is quick feedback and never Evidence, and the full Verify command still runs after the last Ticket, after `run sync` and before every Check pass. `tds-factory doctor` reports it as `verify-fast`, and this repository's fast command runs the unit tests only.
- `tds-factory run sweep` also finds numbers with a unit and headings that only the removed lines held, lists that miss a changed member, and added "linear" or "safe" claims.
- `tds-factory run transition --to check` warns when the diff passes about 40 KB or 15 files, or the branch has fewer commits than Tickets.
- The Exit checklist has a hostile-input step and a hit list for the self-check, and Define decides build or borrow for security-sensitive primitives and splits oversized work.
- The factory Skill and all Stage agents of every Agent target state that a Run follows the Flow through: detailed instructions do not replace Define, no Stage is skipped, a refused transition is not worked around and `run.json` is not edited directly.
- Eval scenarios `small-task-define` and `refused-transition`.
- `tds-factory run inspect` reports `stage-skipped` for a Run still in Define whose branch changes project files.
- Add ESLint and Prettier development commands and CI checks for JavaScript quality.
- The Run record has `requested_model`, `requested_effort`, `observed_model` and `last_seen`, and each Run folder keeps an append-only `events.jsonl` (Stage changes, Tickets done, Verify start and finish with duration, waits, releases and Reworks). `/api/views` returns `model`, `lastSeen`, `events` and `eventsDamaged`. See ADR 0021.
- An instruction guide can declare `applyTo` globs in its frontmatter. Preflight reads only `AGENTS.md` and the unscoped guides, `tds-factory run guides --id ID` lists the guides that apply to a Run's diff, and the Standards and Security reviewers receive only those.
- `tds-factory doctor` has a `guides` check that fails on a linked guide that is missing or has a malformed `applyTo`.
- `tds-factory rules` writes `.claude/rules/` copies of `.github/instructions/*.instructions.md`, with `applyTo` turned into `paths:`, and keeps a copy you edited unless `--force`, and never writes through a symbolic link.
- `tds-factory run sweep --id ID [--term TEXT]...` lists, read-only, every place in the README, docs, Specs, ADRs, glossary, Skills and agents that still holds a term the Run's diff changed (backticked terms, flags, quoted phrases and identifiers) plus the wordings you add with `--term`, with file and line. Hits in files the Run changed are tagged, and hits in files marked as replaced come apart. The Exit checklist uses it and Check passes its output to the Standards reviewer.
- Add an incremental JavaScript type-checking pilot and weekly npm dependency updates.

### Changed
- Check sends a Run back to Build only for a Blocking finding: a violation of a documented standard, a CRITICAL, HIGH or MEDIUM security, infrastructure or project review finding, or a Spec requirement that is missing or wrong. LOW and INFO items, code smells and style judgement are Left open: they are listed but never cause a Rework. Reviewers report a severity and the standard or requirement behind each finding.
- The Dashboard help text for Check and for the Reworks chip says Blocking findings, and the pull request description gets a "Left open" section.
- Use `gpt-6.1-terra` for Codex Check reviews to reduce their model cost.
- The Copilot Define agent uses `claude-sonnet-5.5` again, so Define runs on the same model class on Copilot and Claude. A weak spec costs more in Build and Check than the model saves. `install` keeps agent files you have edited; use `--force` once to take the new default.
- `tds-factory dashboard` prints its URL as a clickable terminal hyperlink when stdout is a terminal.
- The Dashboard has a new design based on Fluent 2: a design token layer in the stylesheet, a Fluent brand blue and status colours, 14 px type, and the same light, dark and System themes. Every text and background pair keeps 4.5:1 contrast, focus rings show in both themes, reduced motion switches transitions off, and high contrast mode redraws the progress fill, status dot, primary buttons and selected card in system colours.
- `tds-factory doctor` reports Claude, Codex and Copilot by default. The shared checks are reported once and each agent gets its own `binary`, `skills`, `config` and `review` checks. The report fails when a shared check is not `pass` or no agent is usable. `--agent` with one agent still reports only that agent. In the JSON report, `checks` now holds only the shared checks and `agents` holds the per-agent checks.
- The list of current Evidence that Run sync, Check Rework and Follow-up Rework clear now lives in one place, so a new Evidence field cannot be kept stale by one transition. Behavior is unchanged.
- The Build Exit checklist starts with the project's static checks (lint, typecheck and format check), so a Run fixes what CI would reject before Check.
- Define recommends the Fast track whenever the work is a bug fix, a documentation or test-title change, or an expected diff of at most about five files without a new public interface, schema or dependency, and names the criterion it meets. You still confirm; it is never applied silently.
- Lower the default models and reasoning effort of the Stage agents to make a Run cheaper and faster. Claude: Define medium, Build low, Check and the interactive check on Sonnet at medium. Codex: Define on `gpt-6.1-terra` low, Build on `gpt-6-luna`, Check and the interactive check at medium, Finish and Follow-up low. Copilot: Define on `claude-haiku-4.5`. `install` keeps agent files you have edited; use `--force` once to take the new defaults.
- Every call of the `gh` command now sits behind one module, the PR provider (`src/pr-provider.js` with the GitHub adapter in `src/pr-github.js`), so the Dashboard, Run clean-up, Follow-up and Run repair share it. No CLI output, Run record or Dashboard API changes. A git remote URL is read by one pattern that accepts `http://`, `ssh://` with or without `git@`, and `git@host:` forms (ADR 0020).
- Check passes the diff against the base, the changed file list and the Verify summary inline to each reviewer, so the read-only reviewers no longer rediscover the change with many tool calls. Reviewers open other files only to follow a reference; a diff larger than about 40 KB is passed as the file list plus per-file diffs up to that size, with the left-out files named.
- The factory Skill tells agents to report `requested_model`, `requested_effort` and `observed_model` once per Stage and to update `activity` often.
- The Factory Skill is smaller: the Fast track, the Define label lookup, the Invoked Skills overrides and the Finish steps moved to `references/` and are read when that Stage needs them. `sync` finds the Skills the Factory invokes in the references too.
- The `factory` Skill is about half the size (about 20 KB, from 40 KB): the progress command list, the `run.json` schema, the Stage agents, the Exit checklist, the Check details and Follow-up moved word for word into `skills/factory/references/`, and the main file names each where it is needed. `install` and `sync` ship the reference files and `tds-factory doctor` fails the skills check when an installed factory Skill lacks them (run `tds-factory install`). No rule of the Flow changes. On the Fast track `build.md` is three lines.

### Removed
- The Build instruction to name a smaller alternative in one line in `build.md`, left over from the removed ponytail Prepare Stage.

### Fixed
- The Dashboard draws an abandoned card with token colours instead of faded text, so its text keeps 4.5:1 contrast. In high contrast mode the primary, danger and pressed buttons keep system colours on hover and press, and a waiting card shows a visible double border. A card keeps its inner focus ring while it is hovered or selected.
- The Dashboard serves `help.js`, so the page no longer fails to load its help panel module.
- Prevent the Dashboard from freezing when a Run file contains an indented Markdown heading.
- Doctor finds the project root when run from a repository subdirectory, including linked worktrees.
- `npm test`, `npm run test:unit`, `test:browser`, `test:package` and `npm run eval` no longer leave thousands of folders in the temp directory. Each run now gets its own temporary directory, which is removed when the command ends. One unit-test run used to leave about 32,000 inodes behind.
- The type check passes with `@types/node` 26, which no longer types `Dirent.path`.

## [0.5.0] - 2026-10-31

### Added
- The Dashboard has new actions: buttons for `run sync`, `run clean` and accepting a Check that is not clean, and a "Needs you" browser notification when a Run starts waiting on you. Starting a Run stays in the agent.
- A Fast track for bug fixes and tiny changes: one confirmation in Define, a one-paragraph Spec and a single Ticket, with Standards and Security still required in Check. The user chooses it, or confirms Define's recommendation, with `tds-factory run track`. The track is recorded in `run.json`, shown on the Dashboard and used to split `run stats` by track.
- `tds-factory run follow-up` collects PR CI failures and unresolved review threads into scoped Rework under the shared Check loop limit.
- An optional committed `.factory/config.json` sets the model per Stage, a Check loop cap (never above 4), the Ticket label and extra Project reviews, without editing agent files or running `install --force`. `tds-factory doctor` validates it and names the line to fix, a Run freezes it, and `tds-factory run config` prints it. `.factory/reviews.json` keeps working.
- Run metrics record Stage visits and Check verdict history, with `tds-factory run stats` and a Dashboard Run detail summary.

### Changed
- The Run store is split into smaller modules behind the same interface, with no change to the CLI, `run.json` or the Dashboard API.
- `docs/evaluation.md` records the first live baseline on Claude (Haiku 5.5, all seven scenarios pass), and `docs/capabilities.md` marks the Claude cells that the run proved.

### Fixed
- The Factory Skill and the install guide now say how to check for a needed label: `gh label list --search <name> --json name`, matching the exact name. The agent asks the user only when the label is absent and treats "already exists" from `gh label create` as present, so it no longer asks for a label the repository already has.
- `tds-factory doctor --agent copilot` (and `/factory` in Copilot) now finds Skills in the Claude and Codex folders, where the default `install` puts them, instead of reporting them missing.
- The offline `gh` in the evaluation answers `repo view` and `label list` for its fixture repository, and the `approval-resolved` grader no longer requires the Spec to be committed.

### Security
- Every Dashboard write route (`DELETE` and `POST`) now needs the page's own Origin and a per-session token, and the server sends no CORS headers. See ADR 0017.

## [0.4.0] - 2026-10-30

### Added
- Build ends with an Exit checklist, after the last Ticket and after every Rework: a term sweep, the required artifacts, a story trace, a security check and a self-check of its own diff. It records no verdict or Evidence; Check still owns the review.
- `npm test` checks that relative Markdown links resolve, ADR numbers are unique, a change to `src/`, `skills/` or `agents/` has a changelog fragment, the docs use no glossary Avoid term and state the Check loop limit as the code does, and browser tests are named so CI runs them.
- Projects can add source or interactive Check reviews through Skills, with configuration and Skill contents frozen per Run.
- The `add-project-review` Skill and guide help projects configure, author, and troubleshoot their reviews.
- `tds-factory run sync` rebases the Run branch onto origin's default branch, and Finish refuses a branch that would not merge cleanly into it.
- Changelog entries go in `changelog.d/` fragments, folded into `CHANGELOG.md` at release time by `node scripts/changelog.js release <version>`.

### Changed
- The default branch is now `main` instead of `master`; workflows, docs and installer links follow.
- Rework sweeps the docs again, reads its own diff and fixes cheap LOW findings in the area instead of leaving them.
- The Dashboard theme and page tests are renamed to `*-browser.test.js` so the CI browser job runs them.
- `install.ps1` supports PowerShell 7 only. The Windows one-line install is now `pwsh -c "irm https://github.com/TDSchreur/tds-factory/releases/latest/download/install.ps1 | iex"`; install PowerShell 7 first. See ADR 0011.

### Security
- The Release version calculation and a Dashboard browser test no longer build a RegExp or a script from input, which closes the two Code Scanning alerts.

## [0.3.2] - 2026-10-30

### Added
- A `ci-ok` job that succeeds only when every other CI job does, for the `master` ruleset to require.
- `SECURITY.md`, `CONTRIBUTING.md`, issue templates and a PR template.
- The release job runs in a `release` environment that only `master` can deploy to.
- `scripts/use-official.sh` and `scripts/use-repo.sh` switch between the latest Release and this checkout, and remove the other version first.

## [0.3.0] - 2026-10-30

### Added
- The Dashboard header shows the Factory version.
- At 1024 CSS pixels and below, the Dashboard shows one Stage at a time, with Stage buttons that carry Run counts and a "Needs you" marker.
- At those widths Run detail fills the screen with a Back control, contained keyboard focus and a locked background.

### Changed
- Dashboard controls are at least 44 pixels high on small screens, long text and links wrap, and dialogs scroll on short screens.
- `dev-install` and `install-dev-skills` are one setup script.
- CI and Release are hardened, and Release checks that the README install URL works.
- A missing Verify line is reported as missing, with the line to add.
- Browser tests set the exact CSS viewport through ChromeDriver emulation.

### Fixed
- The flaky Delete all Dashboard test no longer races the delete requests.

## [0.2.0] - 2026-10-30

### Added
- Runs can now be deleted from every Dashboard column.

### Changed
- The Copilot Define and Check agents are pinned to an available model.
- The Build Stage now carries the instruction that Prepare used to give through ponytail.

### Removed
- **Breaking:** the Prepare Stage.
- **Breaking:** the ponytail skill and its vendored copy.

[0.2.0]: https://github.com/TDSchreur/tds-factory/compare/v0.1.10...v0.2.0
