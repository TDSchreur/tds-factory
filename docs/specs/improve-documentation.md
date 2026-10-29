# Improve the README and the colleague documentation

## Problem Statement

The README mixes an overview with install options, Dashboard internals and Skill sources, and repeats parts of the install guide. The flow diagram reads left to right and gets wide. The usage guide shows the Flow as plain text and has no picture of Run statuses or of where a Run's files live. The `tds-factory doctor` command is easy to miss: the guides mention it in passing, and a colleague whose Run stops at Preflight is not told to run it first. A few statements disagree with each other or with the code.

## Solution

Keep the README as a short overview with a top-to-bottom flow diagram and a map of the documentation. Move the Dashboard details to their own guide. Add diagrams where a picture explains more than prose: the Flow with the points where the Run asks the user, the Run statuses, and the layout of the main checkout, Run store and Run worktrees. Make `tds-factory doctor` visible in the install guide, the usage guide and the README. Check every claim against the code and the `factory` Skill, and fix what does not match.

## User Stories

1. As a new colleague, I want the README to give me the idea and a map of the guides in one screen, so that I know where to read next.
2. As a reader, I want the flow diagram to read from top to bottom, so that it fits the page and follows the order of the Stages.
3. As a reader, I want to see in the diagram where the Run asks me, so that I know when to expect a question.
4. As a user, I want a picture of the Run statuses (running, waiting, verification unavailable, interrupted, done, abandoned) and what moves a Run between them, so that I understand a card on the Dashboard.
5. As a user, I want a picture of where the main checkout, the Run store and the Run worktrees live, so that I know why my own checkout is never touched.
6. As a new user, I want the install guide to tell me to run `tds-factory doctor` after preparing a project, so that I find a missing setup before the first Run.
7. As a user whose Run stops at Preflight, I want the usage guide and the troubleshooting section to send me to `tds-factory doctor`, so that I see which check failed.
8. As a user, I want the Dashboard described in its own guide, so that the README stays short.
9. As a maintainer, I want the docs to match the code and the `factory` Skill, so that a colleague is never told something untrue.
10. As a maintainer, I want the guides to link to each other, including the release guide, so that no document is a dead end.

## Implementation Decisions

- The README's flow diagram becomes `flowchart TB`. It keeps the Preflight and the five Stages, the loop back from Check to Build, and the ask-first path. The two diagrams in the README and the usage guide stay consistent with each other.
- The README drops the "inspired by" sentence (a change the user already made in the working tree).
- A new `docs/dashboard.md` takes the README's Dashboard section: what it shows, deletion rules, ports, routes and the Preact/htm note. The README keeps two lines and a link. The README's Setup section stays in place, because a test requires it to start with the install command.
- The README gets a "Documentation" list linking the install, usage, Dashboard, capability, evaluation and release guides, the glossary and the ADRs.
- The usage guide replaces its plain-text "Flow in one picture" with a Mermaid diagram that marks where the user is asked. It gains a Run status diagram and a "where things live" diagram, and a "Check readiness" step before the first Run that names `tds-factory doctor`.
- The install guide gains a doctor step at the end of project preparation, with the expected output, and the troubleshooting entry for Preflight names it first.
- Fix the inconsistencies found while reading: how many agents run the Check reviews, the `ready-for-agent` label step, the missing links to the release guide and the Dashboard guide, and the code block without a language in the evaluation guide.
- Every claim about commands, Run statuses, files and defaults is checked against `src/`, `bin/` and `skills/factory/SKILL.md`. `GLOSSARY.md` and the ADRs change only where a term is wrong.

## Testing Decisions

- A good test checks what a reader can rely on: links resolve, commands and flags shown exist in the CLI, required phrases are present. It does not check wording.
- The existing guide tests (`test/guides.test.js`, `test/readme-install.test.js`, and the README checks in `test/skills.test.js`) are the seam. `docs/dashboard.md` is added to the guide list so its links and commands are checked too.
- New checks: every Mermaid block in the docs opens with a diagram type and the README flow diagram is `flowchart TB`; the install and usage guides mention `tds-factory doctor`.

## Out of Scope

- Changes to code, Skills, or the Dashboard.
- Translating the documentation.
- Changing the Release or CI process.

## Further Notes

The README and the guides are the first thing a colleague reads, so factual accuracy matters more than length. Keep each document shorter or the same length, apart from the new diagrams.
