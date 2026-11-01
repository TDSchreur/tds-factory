# Per-project config file

## Problem Statement

A project that wants another model for a Stage, a lower Check loop cap, another Ticket label or an extra Project review has to edit the installed agent files or the Factory Skill, and `install --force` then overwrites them. This is [GitHub issue #248](https://github.com/TDSchreur/tds-factory/issues/248), in milestone v0.5.0.

## Solution

An optional `.factory/config.json`, committed in the project, holds the project's settings. `tds-factory doctor` validates it and names the line of each problem. `run start` freezes the settings into the Run, as it already does for Project reviews. The coordinator reads the frozen settings with `tds-factory run config` and applies them: the model when dispatching a Stage agent, the label when cutting Tickets. The Check loop cap is enforced by the CLI. See [ADR 0016](../adr/0016-project-config-is-committed-and-frozen-per-run.md).

## User Stories

1. As a user, I want to set the model for a Stage in the project, so that I never edit installed agent files or run `install --force`.
2. As a user, I want to lower the Check loop cap, so that a Run stops sooner for my project.
3. As a user, I want a cap above the Factory maximum of 4 refused, so that the project cannot weaken the loop bound.
4. As a user, I want to name the Ticket label, so that `to-tickets` uses my tracker's label.
5. As a user, I want to declare Project reviews in the same file, so that one file holds the project's settings.
6. As a user with `.factory/reviews.json`, I want it to keep working unchanged, so that nothing breaks.
7. As a user, I want `doctor` to report a bad setting as `fail` with the line to fix, so that I fix it before a Run.
8. As a user, I want a Run to keep the settings it started with, so that editing the file midway does not change it.
9. As a user, I want a project without the file to behave as today.

## Implementation Decisions

- `.factory/config.json` is a JSON object with the optional keys `models` (Stage name or `interactive-check` to model name), `max_check_loops` (whole number 0 to 4), `labels` (`ticket`, default `ready-for-agent`), `usage` (`true` or `false`, default `true`; `false` stops the reading of the Agent session logs for token Usage, see [ADR 0026](../adr/0026-token-usage-is-read-from-the-agent-session-logs.md)) and `reviews` (same entries as `.factory/reviews.json`). Unknown keys are `fail`.
- Review IDs are unique across `reviews.json` and `config.json`; the legacy file is read first.
- `run start` stores `models`, `max_check_loops`, `labels` and `usage` as `project_config` next to `project_reviews`. A Run without it uses the defaults. `run config --id ID` prints it.
- `max_check_loops` is the lower of the project value and the Factory maximum, in Rework and in Follow-up. The Dashboard chip shows it.
- Doctor adds a `config` check: `pass` without the file or with a valid one, `fail` with a message that names the line.
- The agent files stay the defaults. The coordinator passes the configured model when it dispatches the Stage agent; the CLI cannot set it.

## Testing Decisions

`test/project-config.test.js` runs the CLI against a real repository: freezing, defaults, the lowered cap, doctor's line numbers and the review merge.

## Out of Scope

Other settings, a user-global config, and changing the installed agent files.
