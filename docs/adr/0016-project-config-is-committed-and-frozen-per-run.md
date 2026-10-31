# Project config is committed and frozen per Run

A project needs to set the model per Stage, the Check loop cap, the Ticket label and extra Project reviews without editing installed agent files, which `install --force` replaces. We add `.factory/config.json`. See the [Spec](../specs/project-config.md).

The file is committed in the project, next to `.factory/reviews.json`, which still works and is read first. A Run worktree is cut from the fetched default branch of `origin`, so only committed settings reach it, and the team shares one configuration. `.factory/` stays ignored for Run records and worktrees, so the file needs `git add -f .factory/config.json` or a narrow ignore exception. Secrets do not belong in it. A per-user file was rejected because it would give two people different Runs for one project.

Like [ADR 0010](0010-project-reviews-are-frozen-per-run.md), `run start` freezes the settings into the Run (`project_config`), so an edit midway cannot change a Run. The cost is that an edit applies to new Runs only.

The CLI enforces what it controls. The loop cap is clamped to the Factory maximum of 4, so a project can only lower it. A model is applied by the coordinator, which passes the frozen model when it dispatches the Stage agent; the CLI does not edit agent files. Doctor validates the file and names the line of each problem, so a bad value is `fail` before a Run starts, and `run start` refuses it too.
