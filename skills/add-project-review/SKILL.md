---
name: add-project-review
description: Create or register an additional Factory Check review Skill for this project, including applicability and interactive prerequisites.
---

# Add a project review

Read the Factory's project review guide for the configuration schema and reporting contract. Read the installed Skill's `references/project-reviews.md`; in the Factory checkout the same guide is linked from `docs/project-reviews.md`. Inspect the existing `.factory/reviews.json` first and preserve its other entries.

Identify the review's purpose and whether it uses an existing Skill or needs a project-local Skill. For an existing Skill, use `{ "source": "project", "path": "..." }` for a project-relative folder, or `{ "source": "installed", "name": "..." }` for a global Skill in this Agent target's normal global Skill directory. If authoring a new Skill, create a focused `SKILL.md` with the review's scope, inspection steps, evidence and findings; keep bundled references beside it. Never include credentials in a Skill or its references: the Factory snapshots all bundled files in each Run record.

Assign a unique lowercase hyphenated ID, a display name, `source` or `interactive` mode, and optional repository-root glob patterns. Omit patterns when every change needs review. For an interactive review, identify a local/test startup command, readiness check and test-account setup; put commands and nonsecret guidance in `runtime.start`, `runtime.ready` and `runtime.setup`. Record secret requirements by name only, never their values. Ask the user only for decisions or prerequisites the project cannot supply.

Append the review to `.factory/reviews.json` (the same entries may instead sit under `reviews` in `.factory/config.json`; review IDs must be unique across both files); preserve existing entries, formatting where practical, and unrelated files. If `.factory` is ignored, suggest `git add -f .factory/reviews.json` or a narrow ignore exception for that file only. Do not unignore Run records or worktrees.

Run `tds-factory doctor --json --agent <target>` and inspect the `review` check in its `agents` entry. Fix configuration and missing Skill errors you can resolve; explain any remaining capability or account prerequisite. Report the review ID, Skill location, triggering patterns, interactive setup and validation result. Configuration is frozen at Run start, so an existing Run does not acquire the new review.
