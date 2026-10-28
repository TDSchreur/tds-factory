# Project-aware factory

## Problem Statement

The Factory is stack-neutral, but the teams that use it build C# ASP.NET Core Web APIs on .NET 10, deploy them to Azure with Bicep, and release them through Azure DevOps pipelines. A Run in a real project (CIP.Providers.DataTransferService) showed the gaps. That project already carries its own conventions: an `AGENTS.md` with verify commands, scoped instruction guides, "Universal safeguards" and canonical specs that must change together with the code. The Factory ignores all of it. Define and Finish assume GitHub Issues and `Closes #N`, while the project keeps Tickets as local Markdown in `.scratch/`. Check reviews code only, so Bicep and pipeline changes are never validated. The Run wrote its Spec after the code, and it ran no Security review. Nothing in the Flow stops either.

Generic .NET skills from upstream (xUnit, minimal APIs, Azure Verified Modules) would not help, because the project uses MSTest with Moq, FastEndpoints, private Bicep registry modules and shared pipeline templates. The conventions belong to the project, so the Factory should read them.

## Solution

Make the Flow follow the project it runs in. Preflight reads the project's conventions and verify command. Define and Finish use whichever Issue tracker the project configured: local Markdown by default, GitHub Issues where a project chooses it. Build cannot start without a Spec and Tickets, and Check must report every axis. The project's instruction guides and safeguards feed the Standards and Security axes, and a code change that leaves its canonical spec stale is a finding. A fourth Check axis, Infrastructure, validates Bicep and pipeline changes and blocks Finish while it fails. Finish fills in the project's own PR template.

## User Stories

1. As a developer, I want Preflight to read `AGENTS.md`, the instruction guides it routes to and the canonical specs it lists, so that the Run starts from the project's own rules
2. As a developer, I want the Run to find the project's verify command in the `## Commands` section of `AGENTS.md` or `CLAUDE.md`, so that Build and Check run what the project runs
3. As a developer, I want Preflight to tell me when no verify command can be found and to ask for one, so that no Run proceeds with a guessed command
4. As a developer, I want the verify command and the list of conventions files recorded in `run.json`, so that I can see what the Run used
5. As a developer, I want Build to run the verify command after each Ticket and fix failures before moving on, so that every commit is green
6. As a developer, I want the Run to note commands it cannot run in this environment (for example PowerShell scripts or a container runtime for integration tests), and report them as not run, so that I know what was skipped
7. As a developer, I want Define to publish Tickets to the Issue tracker named in `docs/agents/issue-tracker.md`, so that the Factory works with local Markdown and with GitHub Issues
8. As a developer, I want local Markdown to be the tracker when the project names none, so that no GitHub account is needed by default
9. As a developer, I want Finish to write `Closes #N` only when the tracker is GitHub, and to list the Ticket file paths otherwise, so that the PR body never refers to issues that do not exist
10. As a developer, I want `tickets` in `run.json` to hold issue URLs or file paths, whichever the tracker produces, so that the Dashboard links stay correct
11. As a developer, I want Build to refuse to start while the Spec file or the Tickets are missing, so that code is never written before it is defined
12. As a developer, I want the refusal to say what is missing and send the Run back to Define, so that I know what happens next
13. As a developer, I want Check to run Standards, Spec and Security on every Run and to write a verdict for each into `run.json`, so that no review is skipped silently
14. As a developer, I want Check to fail the pass when an axis has no verdict, so that a missing review counts as a problem
15. As a developer, I want the Standards axis to check the diff against every instruction guide whose `applyTo` globs match the changed files, so that the project's own coding rules are reviewed
16. As a developer, I want the Security axis to treat the project's "Universal safeguards" as explicit checks, so that project-specific rules (sensitive filenames, token generation, retention) are reviewed and not only generic patterns
17. As a developer, I want a finding when code changed but a canonical spec the project routes to for that area was not updated, so that documentation stays in step with behavior
18. As a developer, I want a changed-file trigger for the Infrastructure axis (`*.bicep`, `*.bicepparam`, `bicepconfig.json`, files under `Pipelines/`, `azure-pipelines*.yml`, `*.pipeline.yml`), so that it runs exactly when infrastructure changed
19. As a developer, I want the Infrastructure axis to run `bicep build` and `bicep lint` on every changed Bicep file with the project's own `bicepconfig.json`, so that the project's analyzer levels decide
20. As a developer, I want the axis to resolve private registry modules when it can and to report "not validated" with the reason when it cannot, so that an offline check is not mistaken for a pass
21. As a developer, I want the axis to run a what-if only when Azure credentials and a target are available, and to say so otherwise, so that it never deploys or needs secrets by default
22. As a developer, I want the axis to check changed pipeline YAML for secrets in plain text, unpinned task or template versions and missing approval or environment gates on production stages, so that common pipeline risks are caught
23. As a developer, I want the axis to check the changed infrastructure against the project's stated invariants (for example no Blob soft delete, versioning or immutable retention without a policy change), so that project rules hold in Bicep too
24. As a developer, I want the Infrastructure verdict to be `pass`, `fail` or `skipped` (no infrastructure files in the diff), so that a Run without infrastructure is not blocked
25. As a developer, I want an Infrastructure `fail` to count as a problem worth fixing and to send the Run back to Build within the shared loop cap, so that it follows the same rules as the other axes
26. As a developer, I want Finish to refuse to prepare the PR while Infrastructure is `fail` or "not validated" for a changed file, until I accept the risk explicitly, so that unvalidated infrastructure never ships by accident
27. As a developer, I want my explicit acceptance recorded in `finish.md`, so that the decision is visible later
28. As a developer, I want the Dashboard to show an Infrastructure chip next to the Standards, Spec and Security chips, so that I see its verdict on the card
29. As a developer, I want Finish to fill in the project's PR template when one exists (`.github/pull_request_template.md`, `.azuredevops/pull_request_template.md` or `docs/pull_request_template.md`), including its Documentation, Infrastructure and test checklists, so that the PR matches team habits
30. As a developer, I want the Infrastructure checklist in the PR filled from the Infrastructure verdict, so that the checkbox reflects what was validated
31. As a developer, I want the Factory to fall back to its current generic PR layout when the project has no template, so that nothing breaks for other projects
32. As a maintainer, I want none of this to hardcode .NET, Bicep or Azure DevOps beyond the Infrastructure file triggers and tool names, so that the Flow still works for other stacks
33. As a maintainer, I want the changes to the `factory` Skill to keep the phrasing the skills test relies on, so that `sync` and the tests still find the invoked skills

## Implementation Decisions

- **Everything lives in the `factory` Skill and in the Skills it invokes through prose.** No new shipped Skill and no new upstream submodule entry. The `factory` Skill stays the single owner of the Flow.
- **Conventions step:** Preflight gains a second check, after the existing `/setup-matt-pocock-skills` check. It reads `AGENTS.md` or `CLAUDE.md`, follows the links to instruction guides and canonical specs, and finds the verify command. It writes `commands` (the verify command, one string) and `conventions` (an array of paths read) into `run.json`. The Skill states the lookup order and what to do when a command is missing: ask the user once, then record the answer.
- **Environment limits:** the Run lists commands it could not run (wrong shell, missing container runtime) in the Stage summary under a "Not run" heading. It never reports them as passed.
- **Tracker:** Define reads `docs/agents/issue-tracker.md`. The existing Preflight check guarantees it exists. Local Markdown is the default when the file names no tracker. The Skill stops saying "GitHub Issues"; `to-tickets` already follows the tracker file, so the Skill only needs to stop overriding it. `tickets` entries are URLs or repo-relative paths.
- **Build gate:** the Build section starts with a check that the Spec file named in `spec_link` exists and `tickets` is non-empty. If not, it sets `stage` back to `define`, says what is missing and continues Define.
- **Check axes:** all four axes share the one loop count of two. The Skill says Check fails the pass when an axis it must run has no verdict. Standards receives the matching instruction guides by `applyTo`. Security receives the project's safeguards text from `AGENTS.md`. A stale canonical spec is a Standards finding, judged worth fixing when the changed behavior is documented there.
- **Infrastructure axis:** runs in its own fresh read-only subagent, like the other axes. It uses the Bicep CLI (`bicep build`, `bicep lint`) or `az bicep`, and reads the project's `bicepconfig.json`. It reports module restore failures as "not validated", never as `pass`. A what-if runs only when `az` is logged in and the project documents a target; otherwise it is reported as not run. It never deploys. Findings use the same severities as Security: CRITICAL, HIGH and MEDIUM are problems worth fixing, LOW and INFO are reported.
- **Run record:** the schema gains `infrastructure` (`pass`, `fail` or `skipped`), `commands` and `conventions`. `infrastructure` is set after each review, replacing the old value. `fail` while any CRITICAL, HIGH or MEDIUM infrastructure finding is open.
- **Blocking Finish:** Finish checks `infrastructure` first. On `fail`, or "not validated" for a changed infrastructure file, it sets the Run to `waiting` and asks whether to accept the risk. It prepares the PR only after an explicit yes, and records the decision in `finish.md`. This is the one axis that blocks Finish; after the loop cap the other axes still report and continue.
- **PR template:** Finish passes the repo's PR template, when one exists, to `pr`. The Skill lists the three locations. The Infrastructure section is filled from the verdict and the documentation section from the stale-spec check.
- **Dashboard:** `dashboard.html` adds an Infrastructure chip and reads `r.infrastructure` like the other verdicts. The server and routes are unchanged.
- **Docs:** README Flow table and prose list the new behavior (Preflight conventions, Infrastructure axis, blocking). `GLOSSARY.md` changes **Check axis** to name four axes and adds **Verify command** and **Conventions**. No ADR: each change is a prose change to one Skill and easy to reverse.
- **Install:** after the change `tds-factory install` must be re-run, as the Skill already says.

## Testing Decisions

- **What makes a good test:** only external behavior at the two seams the repo already tests. The Skill's prose is not unit-tested; the tests check what can break mechanically.
- **Seam 1, the skills tests:** the list of Skills the Flow invokes must stay exactly as asserted (the Infrastructure subagent invokes no new Skill), and every invoked Skill stays callable. The tests also check that the Skill text still contains the `Invoke` phrasing for each Skill, and that the `run.json` schema table lists `infrastructure`, `commands` and `conventions`.
- **Seam 2, the Dashboard HTML:** a test checks that a Run with `infrastructure: "fail"` is rendered with an Infrastructure chip carrying the `fail` class, and that a Run without the field renders no chip. Follow the existing dashboard test style.
- **Manual check:** one Run in the DataTransferService repo after `install`. Expect: Preflight records its verify command and conventions; Tickets go to `.scratch/`; Build refuses before the Spec exists; a Bicep change produces an Infrastructure verdict; the PR draft follows `.azuredevops/pull_request_template.md`. This cannot run in CI.
- **Prior art:** `test/skills.test.js` and `test/dashboard.test.js`, both on `node:test`. No new dependency.

## Out of Scope

- Azure DevOps as the Issue tracker, Azure Repos pull requests, or Azure Boards work items.
- Vendoring upstream .NET, ASP.NET, EF Core, xUnit or Azure Verified Modules skills, or any per-framework default profile.
- Running a real deployment, or reading Azure credentials or secrets.
- Validating the shared pipeline templates in other repositories.
- A fallback .NET profile for projects without `AGENTS.md` conventions; that comes later if a team needs it.
- Changing how `code-review`, `security-scan` or `pr` work upstream.
- Making Windows-only commands run on Linux.

## Further Notes

- The findings come from the Run `2026-10-28-azure-defender-status-in-dashboard-2` in CIP.Providers.DataTransferService: Copilot as the writing agent, the Spec written after the code, no `security` field in `run.json`, and Tickets in `.scratch/`. The missing Security verdict may be an older installed copy of the Skill; the Build and Check gates stop it either way.
- The project keeps its PR template under `.azuredevops/` although its remote is GitHub Enterprise. The three template locations cover both.
- Suggested Tickets, in order: (1) tracker follows the project and PR template; (2) Preflight conventions and verify command; (3) Build gate and Check completeness; (4) project rules into Standards and Security, stale-spec finding; (5) Infrastructure axis, run record fields, Dashboard chip; (6) Finish blocks on Infrastructure; (7) README and GLOSSARY.
