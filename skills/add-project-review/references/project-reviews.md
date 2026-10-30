# Add project reviews

Project reviews add required Check axes to the Factory baseline. Ask your coding agent to use `add-project-review` to register an existing review Skill or create a project-local one. Configuration belongs to the project and is read from the fetched default-branch revision at Run start; commit it to that branch before starting a Run. Projects without configuration keep the baseline reviews. Existing Runs never acquire new reviews.

If your `.gitignore` ignores all of `.factory/`, commit only the configuration with `git add -f .factory/reviews.json`, or add a narrow exception for that file. Keep `.factory/runs/` and `.factory/worktrees/` ignored.

## Configuration

Create `.factory/reviews.json` with a `reviews` array. Each ID begins with a lowercase letter and uses lowercase letters, digits and hyphens, at most 64 characters. IDs must be unique and cannot be `standards`, `spec`, `security` or `infrastructure`. Each Skill source is explicit:

- `{ "source": "project", "path": "reviews/angular" }` refers to a project-relative directory containing `SKILL.md`.
- `{ "source": "installed", "name": "angular-review" }` refers to a Skill in the selected target's global Skill directory: `~/.claude/skills`, `~/.agents/skills`, or `~/.copilot/skills`. Use a project reference for locally installed Skills.

```json
{
  "reviews": [
    {
      "id": "angular",
      "name": "Angular",
      "mode": "source",
      "skill": { "source": "project", "path": "reviews/angular" },
      "patterns": ["src/**/*.ts", "src/**/*.html"]
    },
    {
      "id": "ux",
      "name": "User experience",
      "mode": "interactive",
      "skill": { "source": "installed", "name": "ux-review" },
      "patterns": ["src/**/*.html", "src/**/*.css"],
      "runtime": {
        "start": "npm start",
        "ready": "http://127.0.0.1:4200",
        "setup": "Use the local test account described in docs/testing.md; credentials come from environment variables."
      }
    }
  ]
}
```

Patterns are case-sensitive, repository-relative globs: `*` matches within one path segment, `?` one character, and `**` any number of segments. Brace expansion, character classes, negation, backslashes and parent traversal are not supported. Omit `patterns` to run for every change. The full Run diff against its recorded base is used, including both paths of renames and deleted files. A nonmatching review is recorded as skipped with a reason.

For interactive reviews, `runtime.start`, `runtime.ready` and `runtime.setup` are required strings. `start` describes how to start a local/test application, `ready` how to detect readiness, and `setup` how to provision or use test data and accounts. Never store credentials or secrets in the configuration or Skill folder: the Factory snapshots the entire referenced Skill folder, including bundled scripts and binary assets, in the local Run record. Avoid sensitive material there and protect access to `.factory/runs/`.

Run `tds-factory doctor --json --agent codex` (or `claude`/`copilot`) and inspect the `review` check before starting. It reports invalid definitions and missing Skills. A Run uses definitions and Skill contents captured at its start. Later configuration or installed-Skill edits affect new Runs only; missing runtime dependencies still need to be installed.

## Author a review Skill

Write a `SKILL.md` that states the review scope, what to inspect, how to collect supporting evidence and how to report findings. Bundled references and assets belong inside the Skill folder; symbolic links and special files are refused. A source review checks committed changes and surrounding context, in a fresh read-only reviewer. An interactive review additionally exercises a local/test app in a fresh independent reviewer with browser/command access. It must leave implementation files unchanged. Do not deploy or use production accounts or data.

For example, a project-local `reviews/angular/SKILL.md` could contain:

```markdown
---
name: angular-review
description: Review Angular changes for this project's component and accessibility conventions.
---

Inspect the changed TypeScript and templates plus their surrounding components. Check the project's documented Angular version, component conventions, template accessibility and relevant tests. Report the files inspected and each finding with severity, location and a concrete consequence. Do not edit the implementation.
```

For a visual UI review, register an interactive axis using the same `runtime` fields and patterns such as `src/**/*.html` and `src/**/*.css`. A project-local `reviews/ui/SKILL.md` can contain:

```markdown
---
name: ui-review
description: Inspect changed UI screens for visual and interactive regressions.
---

Use the supplied local/test runtime. Open each changed screen at desktop and phone widths. Inspect clipping, overflow, alignment, responsive layout and contrast. Navigate controls with the keyboard and inspect focus indicators. Check the browser console for errors attributable to the changed flow. Save screenshots in the assigned evidence folder and report the screens and widths inspected, screenshot paths, and findings with severity and location. Leave the implementation unchanged.
```

For a UX task-flow review, register another interactive axis such as `ux` with the setup, `runtime` and patterns that apply to your project. Its `reviews/ux/SKILL.md` can contain:

```markdown
---
name: ux-review
description: Review changed user journeys in the local test application.
---

Use the supplied local/test runtime and test account. Complete the changed task from entry to completion, then exercise a validation error and a recoverable failure. Check that labels and instructions communicate the next action, feedback confirms results, and error messages explain recovery. Save screenshots of the inspected states in the assigned evidence folder. Report each task and state inspected, evidence paths, and findings with severity, screen location and user impact. Leave the implementation unchanged.
```

Both interactive examples return the report described below, including `evidence` with screenshot paths; the coordinator records it through `run review`. Keep project-specific acceptance criteria and account setup in the project or Skill. These examples do not assume a particular Angular version or design system.

`tds-factory run reviews --id <run>` prints the frozen plan, applicability, matching paths, UTF-8 text files and exact base64 `encoded_files`. The coordinator materializes the frozen Skill with `tds-factory run materialize-review --id <run> --axis <id>` and gives that directory to the independent reviewer. Never fall back to a live Skill of the same name. If materialization, a reviewer, required browser capability or a prerequisite is unavailable, mark the Run `verification-unavailable` with the review ID and a recovery reason; do not invent a pass.

A reviewer returns what it inspected, findings and a verdict. Each finding has uppercase severity (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO`), a description and a file or screen location. A pass with a medium-or-higher finding is rejected; those findings send the Run to Build. Lower findings are reported. A source-review result can be recorded with:

```sh
tds-factory run review --id "$RUN_ID" --axis angular --data '{"verdict":"pass","inspected":["src/app.component.ts"],"findings":[]}'
```

Record `fail` with findings when problems remain. An interactive pass also needs a nonempty `evidence` array naming existing regular screenshot or browser-evidence files relative to `.factory/runs/<run>/`; store artifacts under `evidence/`, not in the implementation worktree. For example, add `"evidence":["evidence/home.png"]` to the report. The coordinator records `{ "verdict": "skipped" }` only for a nonmatching review; the stored reason comes from the plan. The worktree must be clean for a pass or skip. Required browser artifacts must remain present and unchanged through Finish and merge; the Factory records their hashes with the report.

Each result is tied to the current committed head, recorded base and Check attempt. Missing, failed or stale reviews stop a clean Check; a fresh review and Verify are required after a new commit. Sync clears Evidence when it changes the head or recorded base, because the review scope can change even when the head stays the same. Rework clears prior results and shares the existing four-return limit. A user may explicitly accept an unclean Check for that head only. The Dashboard displays project verdicts and findings alongside the baseline.

## Troubleshooting

- **Missing Skill or invalid configuration:** inspect Doctor's `review` message and correct the path, installed name, mode or ID. Validate from the target you use.
- **Review skipped unexpectedly:** inspect `run reviews` and compare its matched paths to the documented glob rules and recorded base; changing configuration affects the next Run.
- **Browser or app unavailable:** install the declared tooling or arrange the local/test runtime, then resume the paused Run with a fresh reviewer. No pass is recorded without the required evidence.
- **Run starts without newly configured reviews:** commit the config and Skill to the origin default branch before starting another Run. Existing Runs deliberately retain their snapshot.
