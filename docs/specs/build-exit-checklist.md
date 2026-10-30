## Problem Statement

Most Runs fail their first Check, and the same avoidable findings come back loop after loop. Across 21 Runs, 14 went back to Build at least once (22 loops, one Run used all four). The findings are mostly not deep bugs. They are documentation and wording that went stale around a change (one flag worded three ways in eight places, a README line or canonical spec left behind, a glossary clash), a missing or misplaced changelog fragment, a security edge the Build never looked for, and a Spec story with no test. Rework adds to the pile: Build fixes the listed items, the fix opens the next finding, and cheap LOW findings left "on purpose" return one Check later as MEDIUM. Build has no checklist, no self-check and no mechanical tests for these things, while Check is a full independent review.

## Solution

Give Build the means to catch what Check keeps catching, without touching Check. Build ends with an **Exit checklist** that it runs after the last Ticket and after every Rework: a sweep of the docs for every term the change touched, the required artifacts, a table that maps each Spec story to its test, a security check of the trust boundaries the change touches, and a single inline self-check of its own diff. Rework gets stricter: sweep again, read the rework diff, and fix cheap LOW findings in the area instead of leaving them. The mechanical part moves into `npm test`, so the per-Ticket Verify catches broken links, duplicate ADR numbers, a missing changelog fragment, bare Avoid terms, prose that disagrees with a constant, and browser tests that CI would not run.

## User Stories

1. As a Factory user, I want Build to sweep README, docs, specs, ADRs, the glossary and the Factory Skill for every term, flag, number or behavior the change touched, so that stale wording is fixed before Check finds it.
2. As a Factory user, I want a concept to be worded one way everywhere, so that Check never finds three variants of one sentence.
3. As a Factory user, I want Build to add the changelog fragment, update the glossary (respecting Avoid terms), update the canonical spec of the area and add ADR pointers, so that the required artifacts are never the reason for a Rework.
4. As a Factory user, I want Build to write a table in `build.md` that maps each Spec story to the test that proves it, so that an untested story is visible before Check.
5. As a Factory user, I want Build to name each trust boundary the change touches (external input, subprocess working folder, environment or config, deletion or overwrite of user data, fail-open paths) and how it is handled, using the project's Universal safeguards text when it has one, so that security gaps are found by the author first.
6. As a Factory user, I want Build to re-read its own full diff once against the Standards, Spec and Security lenses that Check applies, and fix what it finds, so that cheap findings never reach the reviewers.
7. As a Factory user, I want that self-check to be inline, to start no subagent, not to invoke `code-review`, and to record no verdict or Evidence, so that Check still owns the independent review.
8. As a Factory user, I want the self-check limited to one pass, so that Build does not loop on itself.
9. As a Factory user, I want a Rework to sweep the docs again and to read the rework diff before it commits, so that a fix does not open the next finding.
10. As a Factory user, I want Build to fix cheap LOW findings in the area it is reworking instead of leaving them, so that they do not come back as MEDIUM.
11. As a Factory user, I want anything Build leaves open to be named in `build.md`, so that the reviewers and I see it.
12. As a Factory user, I want the Exit checklist to be part of the Build instructions on every Agent target, so that Claude, Codex and Copilot Build agents follow it.
13. As a Factory user, I want a test that fails when a Build agent file of any target lacks the Exit checklist paragraph, so that the three targets cannot drift apart.
14. As a Factory user, I want `npm test` to fail on a relative Markdown link that does not resolve, in the README, contributing guide, `AGENTS.md`, glossary, docs, the Factory Skill and the agent files, so that broken links are caught after each Ticket.
15. As a Factory user, I want that link check to skip archived Specs and the vendored upstream Skills, so that history and upstream examples do not fail it.
16. As a Factory user, I want `npm test` to fail when two ADR files share a number, or a file in the ADR folder is not named `NNNN-slug.md`, so that a number collision with the default branch is caught as soon as it is synced in.
17. As a Factory user, I want `npm test` to fail when `src/`, `skills/` or `agents/` changed against the merge base with the default branch and no new or changed fragment exists in `changelog.d/`, so that a missing fragment never reaches Check.
18. As a Factory user, I want that fragment check to skip, with a stated reason, when there is no git history or no `origin/main` to compare with, so that the installed package and shallow checkouts do not fail.
19. As a Factory user, I want `npm test` to fail when a documentation file uses a glossary Avoid term as the term, so that vocabulary drift is caught after each Ticket.
20. As a Factory user, I want the Avoid check to skip terms that are ordinary words or carry a qualifier in the glossary, and to skip the glossary, the changelog, ADRs and archived Specs, so that it flags real drift and not prose.
21. As a Factory user, I want `npm test` to fail when documentation states the Check loop limit differently from the code, so that changing the limit cannot leave a stale sentence.
22. As a maintainer, I want that prose check to be a small table of constants and patterns, so that a future constant is a one-line addition.
23. As a Factory user, I want `npm test` to fail when a test file that imports the browser helper and calls `openPage` is not named `*-browser.test.js`, so that CI's browser job, which requires a browser, always runs it.
24. As a Factory user, I want the two existing browser test files that break that rule renamed, so that they run in the browser job.
25. As a Factory user, I want ADR 0005's link to the manual-releases Spec to point to the archive, so that the new link check starts green.
26. As a Factory user, I want the glossary to define **Exit checklist** and to call the fifth step a self-check, not a review, so that the Check axes keep their meaning.
27. As a Factory user, I want the Invoked Skills contract to say the self-check is inline and is not the closing review that `implement-spec` would run, so that Build and Check do not contradict each other.
28. As a Factory user, I want Check, its axes, verdicts and the loop limit unchanged, so that a clean Check still means the same thing.

## Implementation Decisions

- The Exit checklist is part of the Build section of the `factory` Skill and is canonical there. It runs after the last Ticket (before the sync and the move to Check; after the sync, Build runs the Verify command again and fixes failures, so a clash brought in by the sync fails before Check) and again after every Rework, before the rework is committed. Its steps, in order: term sweep; required artifacts; story trace in `build.md`; security check; self-check of the full diff. Anything left open is named in `build.md`.
- Term sweep: search the README, the docs, the Specs, the ADRs, the glossary and the Factory Skill for each term, flag, number or behavior the diff changed, and make every hit say the same thing in one wording. Count the places a sentence lives; if it lives in more than one, check that the wording is the same.
- Required artifacts: a changelog fragment under the right heading, the glossary updated with Avoid terms respected, the canonical spec for the changed area, pointers between ADRs where one supersedes or extends another.
- Story trace: a Markdown table in `build.md` with a row per Spec story and the test that proves it. A story with no test is a gap to close or to name as left open.
- Security check: a list in `build.md` of each trust boundary the diff touches and how it is handled, checked against the project's Universal safeguards text when its conventions have one. A project without it uses the generic boundaries named above.
- Self-check: one inline read of `git diff <base>...HEAD` against the Standards, Spec and Security lenses Check applies. It fixes what it finds, notes what it leaves, creates no subagent, does not invoke `code-review`, and never calls `run verdict` or records Evidence. It is capped at one pass; after a Rework it covers the rework diff.
- Rework: before committing the rework, run the term sweep again, read the rework diff for new surface area, and fix cheap LOW findings in the area being reworked. A LOW that is not cheap is named in `build.md` with the reason.
- The Stage agent files for Build on all three Agent targets carry a short paragraph that names the steps and tells the agent to follow the Exit checklist in the Build instructions. Install does not overwrite an edited agent file, so existing installs keep their text until the user updates it.
- The Invoked Skills contract's `implement-spec` entry gets one sentence: the Exit checklist's self-check is inline and is not the closing review.
- The glossary gets **Exit checklist**, and the fifth step is called a self-check, never a review. No ADR: none of this is hard to reverse.
- New repository tests, all in `npm test`: link resolution (README, contributing guide, `AGENTS.md`, glossary, changelog fragment guide, docs except archived Specs, the Factory Skill, agent files; vendored Skills skipped); ADR number uniqueness and naming; changelog fragment present when `src/`, `skills/` or `agents/` changed against the merge base with `origin/main`, skipped with a reason when `origin/main` does not exist or shares no history with the branch (a shallow fetch), any other git failure failing the test, and a deleted fragment counting as one so the release change that folds the fragments passes; Avoid terms derived from the glossary (case-sensitive whole words, hyphenated terms included, qualifiers and an explicit list of ordinary words skipped; scanned in README, docs except archived Specs, and the Factory Skill; glossary, changelog and ADRs excluded); prose constants (the loop limit, exported from the Run store, against the README, usage guide, Dashboard help text and Factory Skill, including the Dashboard's "maximum is" sentence, its `loop N/4` chip and the README's "fewer than N loops"); browser test naming (a test file that imports the browser helper and calls `openPage` ends in `-browser.test.js`; the helper's other exports, used by the teardown test, do not count); and the Build agent paragraph on every target.
- Rename `dashboard-theme.test.js` and `dashboard-page.test.js` to `-browser.test.js` names. Fix ADR 0005's link to point into the Spec archive.
- A changelog fragment for this change under Added and Changed.

## Testing Decisions

- A good test asserts observable behavior of the repository (a file exists, a link resolves, a sentence matches the constant), not how the check is written. Each new check gets one test that passes on the repo and one that proves it fails on a deliberately bad input, built on a temporary folder with the check exported as a function.
- Seam 1: each mechanical check as an exported function that takes a root folder (or a list of files) and returns problems, tested against temporary folders with good and bad input, plus one test that runs it on the real repo. Prior art: `scripts/changelog.js` with `test/changelog.test.js`, and the link test in `test/guides.test.js`.
- Seam 2: the Skill and agent text through file reads, as `test/skills.test.js` and `test/agents-install.test.js` do: the Exit checklist steps appear in the Factory Skill, each Build agent file carries the paragraph, and the Skill says the self-check records no verdict.
- The fragment check is tested with a temporary git repository (prior art: `test/git-repo.js`): changed `src/` without a fragment fails, with a fragment passes, no `origin/main` skips.
- The browser naming test is tested on a temporary folder of fake test files.

## Out of Scope

Any change to Check, its axes, its verdicts or the loop limit. Syncing the Run branch after Define (deferred). Raising the Build agent's model or effort (deferred). Gating pull requests in CI on the changelog fragment (needs full history in the CI checkout). Checking the Avoid terms that are ordinary words. Detecting stale wording by anything other than the listed mechanical checks; the term sweep itself stays a Build instruction.

## Further Notes

The analysis behind this is the pattern across the 21 Runs in `.factory/runs`: the largest group of first-Check failures were Standards findings about stale documentation and wording, then Security edges nobody looked for, then Spec stories without a test. The Exit checklist targets those groups directly, and the tests move the mechanical ones to the per-Ticket Verify. The first Ticket that changes `src/`, `skills/` or `agents/` must add the changelog fragment, because Verify fails without it.
