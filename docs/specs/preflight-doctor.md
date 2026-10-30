# Preflight doctor: verification readiness before work is dispatched

## Problem Statement

Preflight is prose in the `factory` Skill. The agent checks the setup docs, the CLI and the Verify command by hand, so a malformed or unusable Verify command, a missing required Skill, a missing `origin` or an unavailable reviewer is found late: after a Run exists, or in the middle of Build or Check. A `commands` string in a Run record is not a verified contract: nothing rejects a whitespace-only command or one containing a NUL byte.

## Solution

A read-only `tds-factory doctor` command that checks, in one pass and without changing anything, whether a project is ready for a Run. It reports each check as `pass`, `missing` or `fail` with a one-line reason, as text or `--json`, and exits non-zero unless every check passes. The `factory` Skill runs it as its Preflight. The Run store refuses verification-dependent progress when the Verify command is not usable.

## User stories

1. As a developer, I want one command that tells me everything missing before I start a Run, so that I do not find out halfway through.
2. As a developer, I want it to name the CLI version, so that I know what is installed.
3. As a developer, I want it to name each required Skill that is not installed for my Agent target, so that I can install it.
4. As a developer, I want it to say which tracker setup files are missing, in plain terms and without needing to know another Skill package's setup command, so that I can fix a generic project.
5. As a developer, I want it to tell me when `origin` or its default branch cannot be determined, so that `run start` does not fail later.
6. As a developer, I want it to check the review capabilities (the review Skills and the read-only `factory-check` Stage agent), so that Check is not blocked later by an unavailable reviewer.
7. As a developer, I want a missing Verify command reported differently from a malformed one, so that the agent can ask me for a missing one and refuse a malformed one.
8. As a developer, I want a Run to refuse to verify or to move into Build, Check or Finish while its Verify command is empty, whitespace-only or contains a NUL, so that verification-dependent progress fails closed.

## Implementation decisions

- `src/doctor.js` exports `doctor({ projectDir, agent })` returning `{ ok, checks: [{ id, status, message }], notes: [string] }` (`notes` are non-blocking hints; an optional `prState` replaces the `gh` lookup in tests). `status` is `pass`, `missing` (the user can supply it) or `fail`. Check ids: `cli`, `skills`, `tracker`, `git`, `review`, `verify-command`.
- `tds-factory doctor [--agent claude|codex|copilot] [--json]` prints one line per check, or the object as JSON. `--agent` defaults to `claude`. Exit status is 1 unless every check is `pass`. It is read-only: it fetches nothing and writes nothing. It runs `git ls-remote`, and `gh pr view` for each done Run that records a PR and still has a worktree or branch, to add a note.
- **cli:** reports the `package.json` version and fails when the Node version is below `engines.node`.
- **skills:** the required Skills are the `factory` Skill and every Skill it invokes, read from the shipped `factory` Skill by the word `Invoke` followed by a backticked name. A Skill counts as installed when `<name>/SKILL.md` exists in the Agent target's project or user-global Skill directory (`targets` in `src/flow.js`). The message lists every missing one.
- **tracker:** `docs/agents/issue-tracker.md` and `docs/agents/domain.md` exist and `AGENTS.md` or `CLAUDE.md` has an `## Agent skills` section. The message lists what is missing and never names a setup command.
- Project files are untrusted: `AGENTS.md` and `CLAUDE.md` are read only when they are regular files (a link to one is fine) of at most 1 MiB, and a file that cannot be read fails its check. Git calls time out after 20 seconds and never prompt.
- **git:** the directory is a git repository with a commit, has an `origin` remote and `git ls-remote --symref origin HEAD` yields a valid default branch name. The shared lookup is extracted from `run start` so both use it.
- **review:** `code-review` and `security-scan` are installed and the Agent target's `factory-check` Stage agent file exists in its project or global agents directory.
- **verify-command:** read from the `## Commands` section of `AGENTS.md` or `CLAUDE.md`: the backticked command, or else the rest of the line, on a `- Verify:` list line (`-` or `*` bullet, any case). No such line is `missing`. A command that is empty after trimming, or contains a NUL, is `fail` ("malformed"). A simple command (words made only of letters, digits and `._@+-/`) whose first word is not on `PATH` or a file in the project is `fail`; a command with any shell syntax is not probed.
- `src/run-store.js` gains `verifyCommandProblem(commands)` (empty or whitespace-only, NUL). `run verify` and `run transition` to `build`, `check` and `finish` refuse with that reason. `run start` still accepts an empty `commands`, since Preflight asks the user for a missing one; a non-empty `commands` with a NUL is rejected at start and at the one-time set in `update`.
- The `factory` Skill's Preflight runs `tds-factory doctor --json --agent <this agent>` before creating the Run. It stops on any `fail` or `missing` other than `verify-command`; when only `verify-command` is `missing` it keeps the existing flow (create the Run with an empty `commands`, set `waiting`, ask once). A malformed command is reported to the user, never guessed around. The skills test is updated; the Preflight text before the CLI is installed (the `tds-factory` on PATH check) stays.
- Docs: README, `docs/usage.md`, `GLOSSARY.md` (**Doctor**), and the USAGE text in `bin/tds-factory.js`.

## Testing decisions

Test through the CLI and `doctor()` against temporary projects (`test/git-repo.js`) and temporary homes: each check's `pass`, `missing` and `fail` outcomes, JSON shape, exit status, and that nothing in the project changed. Run-store tests cover the refusal of whitespace and NUL commands for verify and the transitions. The existing skills test covers the Skill text.

## Out of scope

Running the Verify command during doctor, checking `gh` authentication, checking model availability of Stage agents, a per-project configuration file, repairing what is missing.
