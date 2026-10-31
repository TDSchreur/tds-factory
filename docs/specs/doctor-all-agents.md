# Doctor reports all three agents

## Problem Statement

`tds-factory doctor` checks one Agent target, Claude unless `--agent` says otherwise. A user of Codex or Copilot who runs `tds-factory doctor` learns nothing about their own setup, and nobody can see at a glance which of the three agents the Factory is ready for. This is [GitHub issue #273](https://github.com/TDSchreur/tds-factory/issues/273), in milestone v0.6.0.

## Solution

Without `--agent`, the Doctor checks and reports all three Agent targets: claude, codex and copilot. The shared checks (CLI version, tracker setup, Git origin and default branch, Verify command) are reported once; the per-target checks (binary, required Skills, Project config, review capabilities) are reported for each target. A missing agent never fails the report: the Doctor fails only when no Agent target is usable, because a user needs at least one. `--agent X` still narrows the report to one target, and the factory Skill keeps using it, held to the same strictness as before. See [ADR 0018](../adr/0018-doctor-reports-every-agent-target-and-needs-one-usable.md).

## User Stories

1. As a user of Claude, Codex or Copilot, I want `tds-factory doctor` to report every Agent target, so that I see the state of my own agent without knowing a flag.
2. As a user with only Codex installed, I want the Doctor to pass when Codex is ready, so that the missing Claude and Copilot do not block me.
3. As a user with no supported agent installed, I want the Doctor to fail and tell me to install one and run `tds-factory install`, so that I know what to do first.
4. As a user, I want each agent's lines grouped under its name, so that I can tell which agent a `missing` belongs to.
5. As a user, I want an agent whose binary is on PATH but whose Skills are not installed to show that line as `missing`, so that I know to run `tds-factory install`.
6. As a user, I want a missing agent binary reported as `missing`, never `fail`, so that an agent I do not use reads as optional.
7. As a user, I want the failing lines of a non-usable agent to stay visible when another agent is usable, so that nothing is hidden.
8. As a user, I want the shared checks shown once, so that the report stays short.
9. As a user, I want `--agent codex` to report only Codex, so that I can check one target on its own.
10. As an agent running the factory Skill, I want `doctor --json --agent <me>` to hold me to my own Skills, review and config checks, so that Preflight stays as strict as before.
11. As an agent running in an IDE whose command is not on PATH, I want the `binary` check not to count when I named myself, so that Preflight does not block me wrongly.
12. As a script author, I want a stable JSON shape with `checks` for the shared checks and `agents` for the targets, so that I can read both.
13. As a script author, I want `ok` and the exit status to agree, so that `tds-factory doctor` works in CI.
14. As a user, I want an unknown `--agent` to be refused with the list of valid targets, as today.
15. As a user, I want the text output to strip control characters as it does today, so that a hostile project file cannot write escapes to my terminal.
16. As a maintainer, I want the docs, the glossary and the factory Skill to describe the same report, so that nobody reads an outdated shape.

## Implementation Decisions

- The Doctor module builds the shared checks once and the per-target checks for each selected target. The target list is claude, codex, copilot in that order, or the one named by `--agent`.
- A new per-target `binary` check is `pass` when the target's command (`claude`, `codex`, `copilot`) is found on PATH by the same lookup the Verify command check uses, and `missing` otherwise. The command name is the target name.
- A target is a **Usable agent** when all four of its checks pass.
- Without `--agent`, `ok` is true when every shared check passes and at least one target is usable. Targets that are not usable show their lines but do not change `ok`. When none is usable the report carries a top-level failing line: `no agent is usable: install claude, codex or copilot and run tds-factory install`.
- With `--agent X`, only X is reported; `ok` needs X's `skills`, `config` and `review` to pass, and `binary` is shown but not counted.
- The JSON report is `{ ok, checks, agents, notes }`, where `checks` are the shared checks and `agents` is an array of `{ id, usable, checks }`. A report with no usable agent also has a top-level entry in `checks` with id `agents`, status `fail` and the message above, so a reader that only walks `checks` still sees the failure. Text output prints shared checks, then one block per target, then notes; the exit status is 1 whenever `ok` is false.
- The CLI usage line stays `tds-factory doctor [--agent claude|codex|copilot] [--json]`. `agent: undefined` means all targets.
- Documents updated: GLOSSARY.md (Doctor, Usable agent), ADR 0018, the factory Skill and its committed copies, `docs/usage.md`, `docs/install.md`, README mention. A changelog fragment is added.
- The factory Skill's Preflight keeps `doctor --json --agent <your agent>` and stops on any shared check other than `verify-command` that is not `pass`, or on any of the agent's `skills`, `config` or `review` checks that is not `pass`.

## Testing Decisions

- Test through the `doctor()` function and the CLI (`node bin/tds-factory.js doctor`), asserting on the report and the exit status: external behavior only.
- Reuse the fixtures of `test/doctor.test.js` (a temp project with an origin, fake home directory, copied Skills and agents). Control PATH to make agent binaries present or absent.
- Cases: all three targets by default; one target with `--agent`; only one binary on PATH and ready; no binary on PATH; binary present but Skills missing with another target usable; `--agent X` ignores a missing binary; unknown target; text output grouping and escape stripping.
- Existing tests that call `doctor()` with an agent keep their meaning and are adapted to the new shape.

## Out of Scope

- Installing agents or running `tds-factory install` from the Doctor; it stays read-only.
- GitHub CLI and Azure CLI checks (milestone 2 of v0.6.0).
- Counting `gh copilot` as the Copilot binary.
- Changing the install scripts, which only print the report.

## Further Notes

Existing consumers of the report outside this repository that read every check from `checks` will see only the shared checks; ADR 0018 records the trade-off.
