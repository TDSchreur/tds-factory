# Security review

## Problem Statement

When I run the Factory, Check reviews my changes on two Check axes: Standards and Spec. Neither looks for vulnerabilities. A Run can finish with a clean Check and still ship an injection flaw, an exposed secret or a broken access check. I only find out later, or not at all, and the Dashboard shows two green chips that suggest the change was fully reviewed.

## Solution

Check gets a third Check axis, Security. In the same Check pass as `code-review`, the Factory runs a vendored `security-review` Skill over the same diff and reports its result separately from Standards and Spec. A serious finding sends the Run back to Build under the existing loop cap, so a vulnerability gets fixed before the pull request is prepared. The Run record carries a Security verdict, and the Dashboard shows it as a chip next to Standards and Spec.

## User Stories

1. As a developer running the Factory, I want Check to include a security review, so that vulnerabilities are caught before the pull request is prepared
2. As a developer, I want the security review to run in the same Check pass as the code review, so that Check stays one step instead of two
3. As a developer, I want the security review limited to the files in the diff, so that it reports on my change and not on the whole project
4. As a developer, I want the security review to run on every Run, so that Check behaves the same each time and I never wonder whether it was skipped
5. As a developer, I want the Security result reported separately from Standards and Spec, so that one Check axis never hides another
6. As a developer, I want CRITICAL, HIGH and MEDIUM findings to send the Run back to Build, so that real problems get fixed
7. As a developer, I want LOW and INFO findings to appear in the report without sending the Run back, so that noise doesn't burn my loops
8. As a developer, I want the security review to share the single Check loop counter and its cap of 2, so that a Run never loops more than twice in total
9. As a developer, I want Build to apply the fixes after a return, with the report only proposing patches, so that nothing is changed behind my back
10. As a developer, I want the Check summary of each pass to include a Security section, so that I can read what was found and what was decided
11. As a developer watching the Dashboard, I want a Security chip on Check cards, so that I see the outcome of all three Check axes at a glance
12. As a developer watching the Dashboard, I want the Security chip to show pass or fail like the other two, so that the board reads consistently
13. As a developer, I want the Run record to hold a `security` verdict, so that every agent reports it in the same shape
14. As a developer, I want the verdict to be fail while any CRITICAL, HIGH or MEDIUM finding is open, so that the chip matches the rule that sends the Run back
15. As a developer, I want the verdict replaced after each review, so that it always reflects the latest pass
16. As a developer using an older Run record without a `security` field, I want the Dashboard to render it without a chip, so that old Runs still display
17. As a developer, I want the security review to be a committed copy synced from its upstream source, so that it is reviewable in diffs, installs work offline and the pin is explicit
18. As a developer, I want the skill's source pinned as a submodule, so that a re-sync is reproducible
19. As a developer, I want `sync` and `install` to carry the skill's reference files along, so that the skill works after install
20. As a developer, I want the installed skill to be callable by the agent, so that the Check stage can invoke it by name
21. As a developer using Claude, I want the Factory to keep working if Claude's built-in `security-review` is the one that answers, so that Check doesn't break on a name collision
22. As a developer using Codex or Copilot, I want the same Check axes as in Claude, so that the Flow is identical whichever Agent target runs it
23. As a developer reading `GLOSSARY.md`, I want the term Check axis defined, so that the three reviews have one name
24. As a developer reading the README, I want the Check row to list the security review and its verdict, so that the docs match the Flow
25. As a developer reading the Dashboard spec, I want its out-of-scope list to no longer exclude the Security chip, so that the specs agree with each other
26. As a developer, I want the Run to end Check and move to Finish once the loop cap is reached with problems open, so that a stubborn finding can't trap the Run
27. As a developer, I want open findings reported when the cap is reached, so that I decide what to do about them before the pull request

## Implementation Decisions

- **Source:** the `security-review` Skill from the awesome-copilot repository is added as a pinned submodule, and listed in the sync manifest. This follows ADR 0001: committed copies, with submodules only as the sync source. No new ADR.
- **Sync:** the skill's folder is copied as a whole, including its reference files. `sync` does not change the skill's content beyond what it already does for skills the Flow invokes.
- **Name:** the skill keeps its upstream name. If Claude's built-in skill of the same name answers in a Claude session, that is accepted. It reviews the pending changes on the current branch, which is close to what Check needs. The collision is checked during Build, and the skill is renamed only if the collision breaks the Check stage.
- **Check stage in the `factory` Skill:** Check invokes `code-review` and `security-review` in the same pass, and treats Standards, Spec and Security as Check axes with separate reports. Security is scoped to the files in the diff against the same fixed point `code-review` uses. It runs on every Run, with no opt-out.
- **Loop rule:** findings of severity CRITICAL, HIGH or MEDIUM count as problems worth fixing and send the Run back to Build. LOW and INFO are reported only. There is one loop counter and one cap of 2, shared by all three Check axes. After the cap, open findings are reported and the Run continues to Finish.
- **Fixes:** the upstream skill proposes patches and waits for human approval. In the Flow, the report proposes patches and Build applies them after the return. The approval step of the upstream skill is replaced by the Check loop.
- **Run record schema:** a new `security` field, `pass` or `fail`, set after each review and replacing the old value. It is `fail` while any CRITICAL, HIGH or MEDIUM finding is open. The schema table in the `factory` Skill documents it, and the Update rule that lists the fields to refresh after each review includes it.
- **Stage summaries:** `check-N.md` gets a Security section next to the Standards and Spec ones.
- **Dashboard page:** a Security chip next to the Standards and Spec chips, pass or fail, shown only when the record has the field. The reader stays lenient: a missing or unknown value renders no chip. The Dashboard spec's out-of-scope line about per-reviewer chips is amended to say Security is included.
- **Server module:** unchanged. It already passes record fields through as they are.
- **Glossary:** Check axis, already added to `GLOSSARY.md`.
- **README:** the Check row lists `security-review` and says Check returns a Standards, a Spec and a Security verdict.

## Testing Decisions

- **What makes a good test:** only external behavior at the boundary of the shipped skills. A test reads the committed skills and the Flow as data, and does not look at the skill's prose or implementation.
- **One seam, already existing:** the skills test, which reads `skills/` and the Check stage of the `factory` Skill. Every skill the Flow names must exist in `skills/` and must be callable by the model. For `security-review` this also proves the manifest entry exists and `sync` copied the skill with its reference files.
- **Not automatically tested:** the Security chip on the page, which the Dashboard spec already decided is checked by hand; the loop rule and the severity threshold, which only a real Run exercises; and the name collision with Claude's built-in, which is checked during Build.
- **Prior art:** the existing skills test and the Dashboard server tests, both on `node:test`. No new dependency.

## Out of Scope

- Scanning the whole project on every Run; only the diff is in scope.
- A per-Run switch to skip the security review.
- Auto-applying fixes from the security review.
- Dependency auditing beyond what the vendored skill already does.
- Rewriting or forking the upstream skill's content.
- Security verdicts with more than pass and fail on the Dashboard.
- Changing how `code-review` works.
- Any new Dashboard control, route or server change.

## Further Notes

- The upstream skill is published in the awesome-copilot collection, and the Run that produced this Spec previewed it from there.
- After changing the `factory` Skill, the user has to re-run `tds-factory install --force` for it to take effect, because other installers leave real folders of the same names.
