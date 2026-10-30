# Project reviews

Status: implemented; Factory Check pending.

## Problem

Check has four fixed axes in its workflow, Run store, Doctor and Dashboard. A project cannot add independent Angular, UI or UX reviews that participate in Check and Rework.

## Agreed decisions

- Project reviews extend the Factory's baseline axes; they do not replace them.
- Project review findings can send a Run back to Build through the existing Rework loop.
- Reviewers may exercise the application and capture browser evidence while leaving the implementation unchanged.
- A committed `.factory/reviews.json` declares project reviews with a name, explicit Skill reference and optional file patterns.
- File patterns select applicable reviews. A review without patterns runs on every change. Nonmatching reviews are recorded as skipped, with a visible reason.
- Skills may be committed in the project or already installed. References must distinguish their source. Doctor checks availability; missing Skills stop the Run with setup instructions.
- Interactive reviewers receive command and browser capabilities; source reviewers retain their current restrictions. Unavailable required capabilities stop the review rather than producing a pass.
- Provide documentation for configuration, authoring review Skills, Angular/UI/UX examples, browser setup and troubleshooting.
- Ship an `add-project-review` Skill with the Factory. It can register an existing review Skill or help create one, configure file patterns, validate setup and explain usage.
- Each Run keeps the review configuration it started with. Configuration changes apply to new Runs. Older Runs retain the four baseline axes.
- Every project review reports a verdict, findings with severity and file/screen references, and what it inspected. Interactive reviews provide screenshots or browser evidence. Missing required evidence leaves the review incomplete.
- Medium-or-higher findings trigger Rework; lower findings are reported. All applicable project reviews are required initially; advisory-only reviews are deferred.
- Interactive reviews declare startup, readiness and required test-account setup in project configuration or a referenced project guide. The setup Skill helps establish prerequisites. Reviews use a local/test environment, report missing prerequisites, and keep secrets outside committed configuration.
- Each review has a stable ID, display name, explicit Skill source, optional file patterns and an execution mode (`source` or `interactive`). Project-relative Skill paths and installed Skill names are distinct references. Doctor rejects duplicate IDs, baseline-axis name collisions and invalid configuration.
- Applicability uses the entire Run diff against its recorded base, including added, deleted and renamed files. Patterns are documented globs relative to the repository root. A matching file triggers review; the Skill may inspect surrounding code and application behavior for context.
- Each Run captures the configured review Skills and their bundled instructions alongside its review definitions. Updating installed Skills does not change an existing Run's reviews. Missing dependencies and browser capabilities remain explicit prerequisites.
- The Dashboard and Check summaries show project reviews alongside baseline reviews, including findings, skip reasons and unavailable prerequisites. Project reviews share the existing four-Rework limit and explicit acceptance process.

## Repository context

PR #223 (https://github.com/TDSchreur/tds-factory/pull/223) merged the default-branch reference updates. At this interview's continuation, the checkout is on `main` at `837a78e`, containing that merge. Project review design must use each Run's actual base rather than assume a branch named `master` or `main`.

## Completion criteria

- A project can add Angular, UI and UX review Skills without changing the Factory's shipped baseline reviews.
- Doctor validates configuration and Skill availability with actionable errors.
- Every applicable project review participates in current-revision Evidence and Finish eligibility. A missing required review or missing required evidence cannot produce a clean Check.
- Rework clears previous project review Evidence along with baseline Evidence. New commits invalidate previous results and accepted decisions.
- File matching covers the full Run diff, including deletion and both sides of renames. Nonmatching reviews have visible skip reasons.
- Configuration and bundled Skill contents remain stable for a Run; new Runs see updated configuration and Skills. Older Runs keep their baseline axes.
- Interactive review can launch and inspect an application in a local/test environment, collect browser evidence and leave implementation files unchanged. Unavailable prerequisites stop review with a recovery explanation.
- Dashboard and summaries expose each project's review outcomes.
- `add-project-review` can create or register a review Skill, configure applicability and execution prerequisites, and validate the result without replacing unrelated project configuration or Skills.
- Documentation includes a configuration reference, review authoring/reporting contract, Angular/UI/UX examples, browser setup and troubleshooting, and points users to the setup Skill.
- Behavior tests cover configuration validation, applicability, frozen review definitions and Skills, backward compatibility, review Evidence, Finish gates, Rework and Dashboard visibility. Interactive capability limits are documented per Agent target and exercised where the environment supports them.

## Implementation scope

Run gates and Evidence, CLI, Doctor, Dashboard, Stage agent capabilities, Factory invocation contract, the setup Skill, documentation and behavior tests. Projects with no review configuration keep their existing behavior. Advisory-only reviews are outside this initial change.

## User stories

1. As a project maintainer, I can register project-local or installed review Skills without modifying the Factory.
2. As a maintainer, I can select reviews using file patterns and inspect why a review was skipped.
3. As an agent, I can discover and validate review prerequisites before Build.
4. As an agent, I can inspect a Run's frozen review definitions and bundled instructions.
5. As a reviewer, I can report findings and inspection evidence through a documented contract.
6. As a developer, I cannot accidentally Finish with missing, failed or stale project review Evidence.
7. As a UI reviewer, I can exercise the application and report browser evidence without changing implementation.
8. As a developer, I can see project review outcomes and reasons in the Dashboard and Check summaries.
9. As a maintainer, I can use a setup Skill and examples to add Angular, UI and UX reviews.
10. As a developer with an older Run or no project configuration, I retain the existing workflow.

## Testing seams

Use the existing public Run store and CLI seams for validation, snapshots, applicability and Finish/Rework behavior; Doctor's report for setup failures; the Dashboard HTTP/model boundaries for visibility. Use temporary Git repositories and Skill directories, including rename/deletion and changed-installed-Skill scenarios. Exercise the setup Skill with an independent agent in a disposable project after implementation. These seams build on existing Run gate, Doctor and Dashboard tests. Verify each Ticket with `npm test`.

## Tickets

1. Discover, validate and freeze project reviews; expose the Run's review plan and applicability through the CLI.
2. Record structured project review Evidence, enforce Finish/Rework gates and display outcomes in the Dashboard. Blocked by Ticket 1.
3. Enable the interactive review contract, ship the setup Skill and document configuration, authoring and Angular/UI/UX examples. Blocked by Tickets 1 and 2.
