# Improve the factory flow

## Problem Statement

Running the Factory on a real piece of work showed gaps in the Flow. A silent change to the prose of the `factory` Skill dropped skills out of the checks that find them. `implement-spec` and `code-review` assume subagents while the `factory` Skill says nothing about them, so Check ran as a review by the same agent that built the change. `code-review` also runs twice, once inside `implement-spec` and once in Check. The vendored `security-review` shares a name with a built-in skill in Claude, so which one answers depends on install timing. The Run record leaves `check_loops` undefined until the first return, has no home for the PR draft, and costs two writes for every question round. Nothing says how Tickets get closed, when a label may be created, or when Build branches and commits. The Define stage does not hand over the work description. And when several Dashboards run, I can't tell which project one of them shows.

## Solution

Tighten the Flow and its tooling in one pass. The `factory` Skill states the missing rules: where the work description goes, when to branch and commit, which stages use subagents, and how the PR and its Tickets are handled. The shipped `security-review` is renamed so no built-in can shadow it. `install` cleans up stale skills it installed earlier. A guard test turns silent breakage of the Flow prose into a failing test. The Dashboard shows which project it serves.

## User Stories

1. As a developer running the Factory, I want the work description from `/factory` passed into the Define stage, so that I am not asked for it again
2. As a developer, I want `to-tickets` to ask before it creates a tracker label, so that the Factory never changes my repo's labels without my say-so
3. As a developer, I want Build to start on a branch named after the Run, so that my default branch never carries half-built work
4. As a developer, I want the Define artifacts committed first, so that the Spec, glossary and ignore entry are not lost if the Run stops
5. As a developer, I want one commit per Ticket, so that the history reads like the Ticket list
6. As a developer, I want Build to run inline without subagents, so that small Tickets don't pay for coordination
7. As a developer, I want Build to skip the final `code-review` of `implement-spec`, so that the same changes are not reviewed twice
8. As a developer, I want the Standards and Spec reviews of Check to run in fresh subagents, so that the reviewer did not write the code
9. As a developer, I want the Security review to run in a fresh subagent as well, so that the third Check axis is also an independent review
10. As a developer, I want the Check subagents to be read-only, so that a review never changes my code
11. As a developer, I want the PR draft saved in the Run folder, so that the Dashboard can show it while the Run waits for my go-ahead
12. As a developer, I want the PR body to list `Closes #N` for every Ticket, so that merging the PR closes them
13. As a developer, I want `check_loops` to start at 0 in the Run record, so that a Run that never loops reads the same as one that is counting
14. As a developer, I want the next `waiting` write to carry its new reason when no work happens between two questions, so that a multi-round grill costs one write per round
15. As a developer, I want `running` written only when real work starts, so that the Dashboard flags me exactly while I am needed
16. As a developer editing the `factory` Skill, I want a note that the ``Invoke `name` `` phrasing is load-bearing, so that I don't break the checks that read it
17. As a developer, I want a test that compares the skills the Flow invokes with a literal list, so that changing the prose silently shrinks nothing
18. As a developer, I want the vendored security skill shipped as `security-scan`, so that Claude's built-in `security-review` can never answer in its place
19. As a developer, I want Check to invoke `security-scan` by that name, so that every agent runs the same skill
20. As a developer, I want `sync` to rename the skill in its committed copy, so that the rename survives re-syncing
21. As a developer, I want the renamed skill to keep its reference files, so that it works after install
22. As a developer, I want `install` to remove marked skills that are no longer in the shipped set, so that the old `security-review` folders disappear
23. As a developer, I want each removal printed as one line, so that I see what `install` took away
24. As a developer, I want `install` never to touch folders it did not install, so that other installers' skills are safe
25. As a developer with several Dashboards running, I want the page header to show the project directory it serves, so that I know which project I am looking at
26. As a developer, I want that directory available from a small read-only route, so that tools and tests can ask a Dashboard which project it serves
27. As a developer, I want the new route to follow the existing rules (loopback only, GET only), so that the Dashboard stays read-only
28. As a developer reading the README, I want the Check row, the Flow description and the install notes to match the new behaviour, so that the docs tell the truth
29. As a developer reading the Dashboard spec, I want the new route listed, so that the spec matches the server
30. As a developer, I want the security loop rule left untested until a Run hits a real finding, so that no fake test claims coverage it doesn't have

## Implementation Decisions

- **Define handover:** the `factory` Skill passes the user's work description to `grill-with-docs` as its starting point and tells the stage not to ask for it again.
- **Labels:** where a stage needs a tracker label that does not exist, it asks the user before creating it. The `factory` Skill states this for Define.
- **Branch and commits:** Build starts by creating a branch named after the Run slug, off the default branch, and commits the Define artifacts first. Each finished Ticket is one commit.
- **Subagents:** Build runs inline. Check runs the Standards, Spec and Security reviews in fresh read-only subagents. The `factory` Skill says Build skips the closing `code-review` step of `implement-spec`, because Check owns the review.
- **Finish:** the PR draft is saved as `pr.md` in the Run folder, as plain Markdown. The PR body carries `Closes #N` for each Ticket. Pushing or opening the PR still waits for the user's go-ahead.
- **Run record:** the schema documents that `check_loops` starts at 0, and the Start rule writes it. When an answer needs no work before the next question, the next `waiting` write carries the new reason, and `running` is written only when work starts.
- **Load-bearing phrasing:** the `factory` Skill carries a one-line comment saying the ``Invoke `name` `` phrasing is read by the tooling. The Skill keeps that phrasing for every skill it invokes.
- **Rename:** the sync manifest can give a vendored skill a different shipped name. `sync` writes the skill under that name and sets the `name` in its frontmatter to match. The `factory` Skill's Check invokes the new name. The vendored security skill ships as `security-scan`.
- **Stale cleanup:** `install` removes folders that carry the tds-factory marker and are no longer in the shipped set, and prints one line per removal. It never removes a folder without the marker. This holds for every Agent target and for both global and project installs.
- **Dashboard server:** a read-only route returns the project directory the Dashboard serves, as JSON. It follows the existing rules: loopback only, GET only. The page header shows the directory.
- **Docs:** the README and the Dashboard spec are updated, including the Check row, the renamed skill, the new route and the install cleanup. The earlier Spec for the security review is left as history.
- **Glossary:** no new term; Check axis already covers the three reviews.

## Testing Decisions

- **What makes a good test:** only external behavior at the two boundaries below. Tests do not read internal functions, the page DOM or the wording of the Skill's prose.
- **Seam 1, the Dashboard server's HTTP interface:** the existing server tests. A test starts the server over a temp project and checks that the new route returns the project directory, rejects non-GET methods, and listens on loopback only.
- **Seam 2, the skills and install interface:** the existing skills tests. They check that the skills the Flow invokes equal a literal list written in the test; that after `sync` the renamed skill exists under its new name with its reference files and no folder of the old name remains; and that `install` removes a marked folder that is no longer shipped and leaves an unmarked folder alone.
- **Changed test:** the existing test that the vendored security skill ships its reference files is updated to the new name.
- **Not automatically tested:** the page header; the branch, commit and PR rules; Check's use of subagents; the label question; the waiting writes; and the security loop rule. They live only in the prose of the Skill. This Run's own Check is the first look at them.
- **Prior art:** the existing Dashboard server tests and skills tests, both on `node:test`. No new dependency.

## Out of Scope

- A test for the security loop rule and the shared loop counter; it waits for a Run that hits a real finding.
- Stopping old dashboards left behind by earlier agents.
- Any control on the Dashboard, such as starting, approving or stopping Runs.
- Changing how `code-review` or `implement-spec` work upstream.
- Renaming other vendored skills.
- A separate summary file for the Prepare stage.
- Copilot-specific installs beyond what the Agent targets already do.

## Further Notes

- The rename matters most in Claude, where a built-in `security-review` answered until the session's skill list refreshed after an install. A different name removes the dependence on install timing.
- After changing the `factory` Skill or the shipped set, the user re-runs `tds-factory install` for it to take effect. With the stale cleanup, the old `security-review` folders go away on that install.
- The observations behind these changes come from the first Run of the Factory on its own repo: the Run to add the security review to Check.
