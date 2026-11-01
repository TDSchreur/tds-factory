# Catch stale documents in Build instead of Check

Full track. Decision record: [ADR 0027](../adr/0027-stale-documents-are-caught-in-build-with-a-closing-sweep-list-a-documentation-ticket-and-counted-rework-causes.md), which extends [ADR 0023](../adr/0023-check-loops-are-cut-by-sweep-and-checklist-not-by-gates.md).

## Problem Statement

Check sends Runs back to Build because current documents, canonical specs or help text are stale. The latest case was a six-Ticket Run that went back once for five stale places: two guides that still said tokens are not tracked, a canonical spec without the new setting, the Skill's command reference and a command line help text. The Term sweep had listed most of them, but its long output was filtered and truncated at Build, it does not search command line help, and each Ticket updated only the documents it remembered. The Factory also cannot say how often a Rework is caused by stale documents, because a Rework records no reason.

## Solution

Build finds these places before Check does. `run sweep` ends with a short list of the documents still to read and also searches the command line help and the Dashboard help text. The Exit checklist requires reading the whole Sweep output and recording in `build.md` what was fixed and what was judged unaffected. Define names the concrete documents in the Spec, and a Full track Run with three or more Tickets gets a last documentation Ticket. `run rework` takes an optional cause, and `run stats` and the Dashboard count the causes, so the effect of all this can be measured.

## User Stories

1. As a Build agent, I want the Sweep to end with the list of documents still to read, so that truncating or filtering the long output cannot hide a file.
2. As a Build agent, I want that list sorted with the most hits first and without the documents the Run already changed, so that I start where the risk is.
3. As a Build agent, I want a `--files` option that prints only that list, so that I can check it in one short command.
4. As a Build agent, I want the Sweep to find the command line help text that mentions a changed term, so that a stale help line is not missed.
5. As a Build agent, I want the Sweep to find the Dashboard help text that mentions a changed term, so that a stale tooltip or help section is not missed.
6. As a Build agent, I want hits in code to be tagged as code, so that I do not mistake them for documents.
7. As a Build agent, I want error messages and other strings in the source folder left out of the Sweep, so that the output stays readable.
8. As a Build agent, I want Exit checklist step 2 to tell me to read the whole Sweep output unfiltered, so that I do not skip the lists section.
9. As a Build agent, I want to record a Sweep paragraph in `build.md` that names the files I changed because of the Sweep and the hits I judged unaffected, so that my reading is visible.
10. As a Standards reviewer, I want that paragraph in my assignment, so that I can check the hits that were judged unaffected instead of searching again.
11. As a maintainer, I want no new refusal at the transition to Check, so that false positives never block a Run (ADR 0023).
12. As a Define agent, I want the Spec's Documents bullet to name concrete files taken from a Sweep on the feature's key terms, so that Build starts with the list.
13. As a Define agent, I want the Documents bullet to include the canonical specs and the help text, so that they are planned and not remembered.
14. As a Define agent, I want a Full track Run with three or more Tickets to get one last documentation Ticket blocked by all the others, so that the feature-wide documents are one named piece of work.
15. As a Build agent, I want the documentation Ticket to take the Sweep output as its input, so that it brings the documents in line with the finished feature.
16. As a Define agent, I want Runs with fewer than three Tickets and Fast track Runs to get no extra Ticket, so that small work stays small.
17. As a user, I want `run rework` to take an optional cause from a fixed list (`stale-doc`, `test-gap`, `spec-gap`, `security`, `bug`, `size`, `other`), so that I can see why Runs go back to Build.
18. As a user, I want to give more than one cause for one Rework, so that a mixed Check is described honestly.
19. As a user, I want an unknown cause to be refused with the list of valid ones and the Run left unchanged, so that the counts stay clean.
20. As a user, I want a Rework without a cause to keep working and count as unknown, so that older scripts and Runs are not broken.
21. As a user, I want `run stats --id` to print the causes of this Run's Reworks, so that I can see them next to the Rework count.
22. As a user, I want `run stats --all` to print the Reworks per cause across all Runs, with the unknown ones named, so that I can see the main driver.
23. As a Dashboard user, I want Run detail to show the same causes with the same labels, so that I do not need a terminal.
24. As a user with older Runs, I want their Reworks to show as unknown, so that no cause is invented.
25. As a Check agent, I want the Factory skill to tell me to pass the cause of each Blocking finding to `run rework`, so that the data is filled in.
26. As a maintainer, I want the Factory skill, its command reference and the Run record schema to describe the new option and field, so that the documents match the behavior.

## Implementation Decisions

- **Sweep summary.** The Sweep report gains a closing list: each current document with hits that the Run did not change, with the number of hits, sorted by hits and then by name, capped so the list stays short, with a line saying how many more there are. The existing sections are unchanged. The list is always printed; `--files` prints only the list. The Sweep stays read-only and judges nothing.
- **Code strings.** The Sweep also reads the command line entry file and the Dashboard help text file, and reports hits there tagged as code. Other source files, and error messages in them, are not searched. Reading follows the existing safe rules: regular files only, a size limit, no links.
- **Exit checklist.** Step 2 says to read the whole output unfiltered, including the lists section and the closing list, and to write a Sweep paragraph in `build.md` that names the files changed because of the Sweep and the hits judged unaffected. On the Fast track the paragraph is one line. Nothing refuses the transition to Check if the paragraph is missing.
- **Standards reviewer.** The Check reference tells the Standards reviewer to read the Sweep paragraph and to look at the hits it judged unaffected.
- **Define.** The Define section of the Factory skill and its Define reference say that the Spec's Documents bullet names concrete files from a Sweep on the feature's key terms, including canonical specs and help text. The `to-tickets` override says that a Full track Run with three or more Tickets gets one last documentation Ticket blocked by every other Ticket, whose input is the Sweep output. The Fast track and Runs with fewer than three Tickets get none.
- **Rework cause.** `run rework` accepts an optional, repeatable cause from the fixed list. An unknown cause is refused before anything changes. The causes are stored in the Run metrics with the Rework they belong to, written by the same named operation under the same lock as the Rework itself, and cannot be supplied by an ordinary update. The metrics stay versioned; older records without causes read as unknown.
- **Stats and Dashboard.** `run stats --id` prints the causes next to the Rework count. `run stats --all` prints the Reworks per cause with the unknown ones named. Run detail shows the same, using the same calculation and labels.
- **Check reference.** The Check section tells the agent to pass the cause of each Blocking finding when it runs `run rework`.
- **Documents.** The Factory skill, the progress command reference, the Run record schema, the Exit checklist, the Check and Define references, the usage guide, the Dashboard guide, the glossary and a changelog fragment describe the changes. The Run record schema names the new metrics field.

## Testing Decisions

- A good test drives the public command or the page and asserts what the user sees or what the Run record holds, not helper names.
- **Seam 1, the Sweep through the CLI.** Temporary git repositories with a Run, a diff that adds a list member, a changed term, and documents and help text that mention them. Assert the closing list (order, no changed documents, the cap and the "more" line), `--files`, hits in the command line help and the Dashboard help text tagged as code, and that other source files are not searched. Prior art: the Sweep tests.
- **Seam 2, rework and stats through the CLI.** Real transitions in a temporary repository. Assert that causes are stored and printed for one Run and for all Runs, that several causes are accepted, that an unknown cause is refused and leaves the record unchanged, that a Rework without a cause counts as unknown, and that old records print as unknown. Prior art: the Run metrics tests.
- **Seam 3, the Dashboard.** The existing browser fixture opens Run detail and checks the cause line for a Run with causes and for a legacy Run.
- **Seam 4, the skill text.** The existing tests that pin the stated rules of the Factory skill gain assertions that the Exit checklist asks for the Sweep paragraph, that Define states the documentation Ticket rule with its threshold, and that Check passes the cause. Prior art: the tests that check the skills.
- The Sweep paragraph and the documentation Ticket are agent behavior; the tests pin what the instructions say, not what an agent does.

## Out of Scope

- Any refusal at `run transition --to check` based on Sweep hits or on a missing paragraph.
- Searching error messages and strings in the source folder, or any other file type.
- A map from code areas to documents.
- Classifying causes automatically, or making the cause required.
- Changing Check's Blocking rules, the loop cap or the axes.

## Further Notes

- The Sweep output of the last Run already lists the documents that were missed, but only inside the long sections; the closing list is meant to make them impossible to miss even when the output is cut.
- The success measure of ADR 0023, fewer Check loops and more clean first Checks, can now be read by cause.
