# Size gate B: Define estimates the Run size and proposes a split

Continues [Size gate](run-size-gate.md), whose Run A built the measurement, the wait and the two answers on the command line ([ADR 0035](../adr/0035-build-waits-on-the-user-when-a-run-outgrows-the-size-limit.md)). That Spec planned one Run B for stories 10 to 13. Its own estimate shows that Run B does not fit either, so it is cut again: this Run carries the Skill text (stories 10, 11 and 13); the Dashboard buttons (story 12) and the leftovers of Run A go to a later Run, in one issue.

## Problem Statement

Build now stops a Run that outgrows the size limit, but only after the code is written. Define still does not record an estimate, so the user hears about a Run that is too big when Build waits, and the Fast track never notices that a "tiny" change is not tiny. When the user answers a size wait, the Skill does not say what the agent does next, so the moved Tickets get no new Run.

## Solution

Define puts an estimate per Ticket (files and KB of diff) in the Spec and judges it against a margin below the limit, because estimates run low. Above the margin it proposes a split with a suggested cut in the confirmation, and the user decides. After a split, Tickets are cut only for the first Run; each later Run gets one issue that describes its scope. On the Fast track, a diff estimate above the limit turns the single confirmation into a proposal to use the Full track. The Waiting section of the Skill tells the agent what to do after each answer to a size wait.

## User Stories

Stories 10, 11 and 13 of [Size gate](run-size-gate.md), made concrete:

1. As a user, I want the Spec to hold an estimate per Ticket (files, KB), a row for the Define artifacts and a total, so that I see before Build whether the Run fits.
2. As a user, I want a Run to count as fitting only when the estimate stays under about two thirds of the limit (10 files, 27 KB), so that an estimate that runs low does not still end in a size wait.
3. As a user, I want tests counted at their real size and Markdown by the length of its lines, so that the estimate does not repeat the mistake of Run A.
4. As a user, I want Define to propose a split with a suggested cut in the confirmation when the estimate is above the margin, and to leave the decision to me, so that I choose the scope of each Run.
5. As a user, I want Tickets cut and published only for the first Run after a split, and one issue per later Run that describes its scope, so that every Run has its own Define when it starts.
6. As a user on the Fast track, I want the single confirmation to say that the estimate passes the limit and to propose the Full track, so that a big change does not go through the one-Ticket Flow.
7. As an agent, I want the Waiting section of `SKILL.md` to say what to do after "split" and after "accept", so that I run the right command, take the Run on to Check or continue Build, and start the new Run for the moved Tickets with `/factory` and their links.
8. As an agent resuming with `/factory continue`, I want `references/continue.md` to tell me that a Run waiting for the size answer stays waiting until the user answers, so that I never answer for the user.

## Implementation Decisions

- **Estimate.** `references/define.md` (Size) says what the Spec carries: a table with a row per Ticket, a row for the Define artifacts the Run commits (the Spec counts) and a total, in files and KB of diff. It counts what the Run size counts (no lockfiles, no `test/fixtures/`), tests at their real size and Markdown by the length of its lines.
- **Margin.** The Run fits when the total stays at or under two thirds of the limit: 10 files and 27 KB. The limit itself (about 40 KB, about 15 files) stays what Build enforces. Above the margin Define proposes a split; it never splits without the user's answer.
- **After a split.** Define cuts and publishes Tickets only for the first Run. Each later Run gets one issue on the tracker with its scope (what it carries, why it was cut, what it needs first) and no Ticket label, because it has no Tickets yet. The first Run's Spec names the issues. The later Run starts with `/factory` and its own Define.
- **Fast track.** `references/fast-track.md` asks for an estimate before the confirmation. When it passes the limit the confirmation says so and proposes the Full track, like the existing advice for work bigger than a tiny change. The user chooses the track.
- **Waiting.** `SKILL.md` gets one bullet for the Build wait with the reason of ADR 0035, saying what follows each answer: split runs `run split`, which prints the links of the moved Tickets, then the Run goes on to Check and the agent starts a new Run with those links; accept runs `run size --accept` and Build goes on. `references/continue.md` gets the case of a Run that still waits for the size answer. `SKILL.md` stays under its 18 KB limit.
- **Documents.** From the Sweep: `references/define.md`, `references/fast-track.md`, `references/continue.md`, `SKILL.md`, the Fast track paragraphs in `README.md` and `docs/usage.md`, and the "Later" paragraph of ADR 0035 (Define's estimate is no longer later), the first Spec `docs/specs/run-size-gate.md` (it no longer calls Run B one Run), `docs/specs/reduce-check-loops.md` (story 9), ADR 0023 (pointer), a test in `test/skills.test.js` and a changelog fragment. The **Run size** Glossary entry gains Define's estimate.

## Size estimate

The Run is held to its own rule: 10 files and 27 KB, without lockfiles and `test/fixtures/`.

| Part                                                                                 | Files | KB     |
| ------------------------------------------------------------------------------------ | ----- | ------ |
| Define artifacts (this Spec)                                                         | 1     | 8      |
| Ticket 1: Size section, Fast track, `README.md`, `docs/usage.md`, changelog fragment | 5     | 4      |
| Ticket 2: Waiting bullet, `continue.md`, ADR 0035                                    | 3     | 2      |
| **Total**                                                                            | **9** | **14** |

The table was the plan. In Define the user added the first Spec's update and a Skill-text test, and Check added `reduce-check-loops.md`, ADR 0023 and the Glossary: the Run as built is 14 files and about 30 KB, over the margin and under the limit, and the user accepted that. Twice now the estimate came in low by about half, so the margin is kept. What does not fit goes to a later Run (see Out of Scope): the Dashboard buttons alone are about 9 files and 20 KB (route, handlers, model, components, app, help, `docs/dashboard.md`, `docs/usage.md`, tests), and the leftovers of Run A add about 7 files.

## Testing Decisions

The work is Skill text, so the seam is `npm test`: the Skill checks (the 18 KB limit of `SKILL.md`, links and references that resolve), the Markdown, link and glossary checks, and two tests in `test/skills.test.js` that pin the rules, as the other Skill rules there are pinned: the Define estimate, margin, split proposal and later-Run issues with the Fast track move, and the Waiting answers in `SKILL.md` and `continue.md`. The reviewer reads the Skill text against the stories above.

## Out of Scope

Left to one later issue, [#530](https://github.com/TDSchreur/tds-factory/issues/530), which needs its own Define and a split in two (Dashboard first, then the leftovers):

- Split and Continue buttons on a Run waiting for size: guarded write routes ([ADR 0017](../adr/0017-dashboard-write-routes-need-origin-host-and-a-session-token.md)) with `updated` freshness like Accept Check ([ADR 0024](../adr/0024-the-user-can-grant-an-extra-check-loop.md)), the moved Ticket links, **Copy agent prompt**, help text, `docs/dashboard.md`, `docs/usage.md`, and the Dashboard line in the Waiting bullet and `continue.md`.
- Leftovers of Run A: the Spec wording for `size --accept` on a running Run in Build or Check and for an overflow counting as over the limit; one shared character class for the printed links (control and format characters, with the `u` flag); reporting a split event that could not be written (check the boolean `appendEvent` returns); a timeout on the git measurement, counted as over the limit like an overflow (unknown would let a hung or huge repository pass the gate, and the user can always answer Continue).
- The red-check, as in the first Spec.

## Further Notes

The table above is the first estimate that uses the margin. This Run updated the first Spec, so it no longer describes Run B as one Run.
