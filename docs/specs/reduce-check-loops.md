# Reduce the number of Check loops per Run

_The Sweep now also searches the command line help and the Dashboard help text, ends with the list of documents still to read, and Define and Build gain steps for documents: see [Stale documents in Build](stale-documents-in-build.md) and [ADR 0027](../adr/0027-stale-documents-are-caught-in-build-with-a-closing-sweep-list-a-documentation-ticket-and-counted-rework-causes.md)._

## Problem Statement

A Run is often sent back from Check to Build for findings Build could have found itself. Run `2026-11-01-scope-conventions-by-path-globs` needed three Checks and `first_check: unclean`; two earlier Runs had one Rework each. The causes: the term sweep misses enumerations (a member added to a list, a changed number, a moved section) so current documents go stale; security-sensitive code over untrusted input ships without an adversarial test and with unproven "linear" or "safe" claims; Build hand-rolls a security-sensitive primitive that Define should have decided; the diff grows past what Check can review in one pass and Build makes one commit for several Tickets; and Build's self-check is unfocused.

## Solution

Five changes, each cutting one cause. The Sweep finds stale numbers, removed headings and lists that miss a changed member, and lists claims to prove. The Exit checklist gains a hostile-input step and a hit list of the usual Check findings. Define decides build-or-borrow for security-sensitive primitives and splits oversized work. `run transition --to check` warns when the Run is too large or has fewer commits than Tickets. Check's Blocking rules are unchanged.

## User Stories

1. As Build, I want the Sweep to list current documents that still hold a number the diff removed (for example "21 KB"), so that a changed cap is updated everywhere.
2. As Build, I want the Sweep to list current documents that still mention a heading the diff removed or renamed, so that links and pointers to a moved section are fixed.
3. As Build, I want the Sweep to list lines in current documents that hold the siblings of a list member the diff added but not that member, so that every list gets the new member.
4. As Build, I want the same for a member the diff removed, so that no list keeps a stale member.
5. As Build, I want the Sweep to list the added lines that claim "linear", "bounded", "safe" or similar, so that I prove each with an adversarial test or remove it.
6. As Build, I want the Exit checklist to require an adversarial test for every parser, matcher or path-handling function over untrusted input, also after a Rework, so that hostile input is tested before Check.
7. As Build, I want a short hit list of the usual Check findings in the self-check, so that I look for stale documents, symlinks, control characters, stated caps and silent drops.
8. As Define, I want to name the approach (dependency, simpler syntax, or hand-rolled with a required adversarial test) when a Ticket needs a security-sensitive primitive the platform lacks, so that Build does not decide it alone.
9. As Define, I want to split work into separate Runs or Tickets when the estimate passes about 40 KB of diff or about 15 files, so that Check can review the whole diff in one pass.
10. As a maintainer, I want `run transition --to check` to warn, without refusing, when the diff passes about 40 KB or 15 files or the branch has fewer commits than Tickets, so that an oversized Run is visible before Check.
11. As a maintainer, I want Check's Blocking rules unchanged, so that quality does not drop.

## Implementation Decisions

- The Sweep (`run-sweep`) derives more terms from the diff: numbers with a unit that occur only on removed lines, and the text and anchor of headings that occur only on removed lines. These get their own budget so the existing most-frequent-term cut-off does not drop them.
- The Sweep adds a "lists" section. An enumeration is a line with at least three backticked tokens. A member is added (removed) when it is on added (removed) lines of a file and not on the other side. The report lists current document lines holding at least two siblings of the member and, for an added member, not the member; for a removed member, still the member. Hits in replaced documents are left out. Output is cleaned of control characters and capped like the other sections.
- The Sweep adds a "claims" section: added lines holding words such as linear, bounded, constant time, safe, sanitized, O(...). It judges nothing.
- The transition to Check measures the diff from the Run base to head (bytes of added and removed lines, files changed) and the commit count, and returns warnings. The CLI prints them to stderr; the transition still succeeds. Thresholds: 40 KB, 15 files; fewer commits than Tickets.
- Skill text: the Exit checklist gets a hostile-input step and a self-check hit list; Define reference gets build-or-borrow and the size cap; Build's one commit per Ticket is restated in the checklist. SKILL.md stays under its 18,000-byte cap.
- ADR 0023 records the decisions, including that the size cap is a warning, not a gate, because the estimate is a judgement and a gate would block legitimate large Runs. GLOSSARY entries for Sweep and Exit checklist are updated. A changelog fragment is added.

## Testing Decisions

- Test external behavior through the CLI (`run sweep`, `run transition`), as `test/run-sweep.test.js` and `test/run-gates.test.js` do, and through the Skill text tests in `test/skills.test.js`.
- Sweep tests cover: a removed number, a removed heading, an added and a removed list member, a claim line, no false list hit when the member is present, and hostile input (control characters in a document, a very long line, a symlinked document, a huge number of backticks on one line) staying bounded and clean.
- Transition tests cover: no warning on a small Run, a warning for size, file count and too few commits, and that the transition succeeds.
- Skill text tests assert the new steps exist.

## Out of Scope

- Refusing a transition on size.
- Changing Check's Blocking rules, loop cap or reviewer assignment.
- Sweeping non-Markdown files other than the command line help and the Dashboard help text (added by [Stale documents in Build](stale-documents-in-build.md)), or plain (unquoted) comma lists.

## Further Notes

Success measure: fewer `check_loops` and more `first_check: clean` in later Runs (`tds-factory run stats --all`).
