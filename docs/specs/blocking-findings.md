# Only serious findings send a Run back to Build

## Problem Statement

Sixty percent of Runs need at least one Rework, and Standards fails in 40% of Check passes, mostly on low documentation items. The Check rule sends a Run back for any finding the coordinator "judges worth fixing", so the line moves with the reviewer: a different fresh reviewer raises different low items each pass, and the loop does not converge. In the all-agent Doctor Run, loops 3 to 5 were low items on older Specs. This is [GitHub issue #285](https://github.com/TDSchreur/tds-factory/issues/285), priority work of milestone v0.6.0 (see the Factory performance analysis).

## Solution

Check sends a Run back to Build only for a **Blocking finding**. Everything else is **Left open**: it is written down and shown to the user, but never causes a Rework and never stops a Clean Check. Reviewers give every finding a severity and the standard or requirement it breaks, so the coordinator applies a rule instead of a judgement.

## User Stories

1. As a user, I want only violations of a documented standard, CRITICAL, HIGH or MEDIUM security, infrastructure or Project review findings, and missing or wrong Spec requirements to send a Run back, so that Runs stop looping on small items.
2. As a user, I want a LOW, INFO or judgement finding to be listed and not to cause a Rework, so that I still see it without paying for another Check pass.
3. As a user, I want a stale statement in a document that describes current behavior (README, the usage and install guides, `GLOSSARY.md`, an accepted ADR, a canonical spec) to block, so that the documentation stays true.
4. As a user, I want the same stale statement in an older Spec that is not canonical to be Left open, so that history does not cost loops.
5. As a user, I want behavior the Spec did not ask for to be Left open unless it contradicts a requirement or an "Out of scope" statement, so that harmless extras do not block.
6. As a reviewer, I want to report each finding with a severity (CRITICAL, HIGH, MEDIUM, LOW, INFO) and the standard, requirement or "judgement" it rests on, so that the coordinator can apply the rule.
7. As a reviewer, I want every smell from the smell baseline and every style or design judgement to be at most LOW, while a CRITICAL, HIGH or MEDIUM security, infrastructure or Project review finding blocks whatever its basis, so that judgement never blocks and a real vulnerability is never capped.
8. As the coordinator, I want to apply the reviewer's severity and not raise a LOW to a Blocking finding, and to write down any disagreement in `check-N.md`, so that the outcome does not depend on me.
9. As a user, I want an axis verdict to be `fail` only when it has a Blocking finding, so that a Check with only Left open items is clean.
10. As a user, I want the Left open list in `check-N.md` (axis, severity and basis per item), in `finish.md` and in a "Left open" section of the pull request description, so that nothing is lost and nothing needs my approval.
11. As a maintainer, I want the definition of a Clean Check unchanged and no new field in the Run record, so that the Evidence and Dashboard rules stay as they are.
12. As a user, I want Follow-up scope, the cap of four loops, the advice to fix cheap LOWs in the area being reworked and the independence of the reviewers unchanged.
13. As a maintainer, I want a test that pins the rule text, so that the threshold cannot drift back to "worth fixing".

## Implementation Decisions

- A **Blocking finding** is one of: a violation of a documented standard that names the rule (a "must" or "never" in `AGENTS.md`, `CONTRIBUTING.md`, an instruction guide, the glossary's Avoid terms, a canonical spec); a CRITICAL, HIGH or MEDIUM security, infrastructure or Project review finding; a Spec requirement that is missing or wrong. Anything else is **Left open**. Both terms are in `GLOSSARY.md`, and **Rework** is reworded.
- The `factory` Skill Check section states the rule once and the Check loop wording uses "Blocking finding" instead of "problem worth fixing". It tells the coordinator to pass the severity/basis request in each reviewer's assignment and to apply the reviewer's severity.
- The Stage agents `factory-check` and `factory-interactive-check` of all three targets say the same in one sentence.
- A stale statement counts as a violation of a documented standard when it sits in a document that describes current behavior; in a historical Spec in `docs/specs/` that is not listed as canonical in the conventions it is Left open.
- Behavior the Spec did not ask for is Left open unless it contradicts a requirement or an "Out of scope" statement.
- `check-N.md` gets a "Left open" list; Finish copies it into `finish.md` and the PR body. The `pr` step fills a "Left open" section of the PR description from `check-N.md`. The PR template of this repository needs no change.
- An axis verdict is `fail` only with a Blocking finding. The definition of Clean, the schema and the Dashboard do not change.
- `docs/usage.md` (the flow diagram label and the Check bullet) and the README Check description say the same.

## Testing Decisions

- Tests read the shipped text, as the existing Skill tests do: `test/skills.test.js` pins the new rule text (the three classes, "Left open", severity and basis requested from reviewers, LOW and INFO never block) and replaces the assertions on "problem worth fixing"; a test checks the three targets' `factory-check` and `factory-interactive-check` agents carry the sentence; the docs checks (links, glossary Avoid terms, loop limit statement) keep passing.
- Prior art: `test/skills.test.js` Check tests, `test/agents-install.test.js`, `scripts/doc-checks.js` (Avoid terms).
- No live eval; a live eval is out of scope for this change.

## Out of Scope

- Giving reviewers the diff inline (#286), the term sweep command (#287), smaller re-review after a Rework (#289).
- Changing Follow-up, the loop cap, the Fast track, the Run record or the Dashboard.
- Changing the reviewers' tools or independence.

## Further Notes

The analysis behind this change is in the Obsidian note `analysis-factory-performance.md`. Target for the priority block: average loops per Run below 0.5.
