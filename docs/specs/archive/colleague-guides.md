# Colleague guides

## Problem Statement

A colleague who wants to use the Factory has one install line in the README and no guide. They do not know what to install first, how to prepare a project, how to start a Run, what the agent will ask them, or what the Dashboard shows. The install line also ends at a wall: `/factory` stops at Preflight unless the project has been through `/setup-matt-pocock-skills`, and `tds-factory install` does not ship that skill. Most colleagues use GitHub Copilot, and the README only mentions it in a table.

## Solution

Two guides in English, `docs/install.md` and `docs/usage.md`, linked from the top of the README. The install guide takes a colleague from nothing to a working `/factory` in GitHub Copilot, with short notes for Claude and Codex. The usage guide walks through one Run, from the first message to the merged pull request, and explains the Dashboard. `tds-factory install` also ships `setup-matt-pocock-skills`, so the install guide needs no extra download.

## User Stories

1. As a colleague, I want a list of what to have installed before I start, so that I do not fail halfway
2. As a colleague, I want a check command for each prerequisite, so that I know whether it is already fine
3. As a colleague, I want the install command and the update command in one place, so that I can copy them
4. As a colleague, I want to check the installed version, so that I can tell whether I need to update
5. As a colleague using GitHub Copilot, I want to know where the skills land and that Copilot finds them, so that I trust the install
6. As a colleague using GitHub Copilot, I want to know how to start `factory` from the chat, so that I can begin
7. As a colleague using Claude Code or Codex, I want a short note on how my agent differs, so that I can still follow the guide
8. As a colleague, I want to know how to prepare a project for the Factory, so that `/factory` does not stop at Preflight
9. As a colleague, I want `setup-matt-pocock-skills` to be installed with the Factory, so that I do not hunt for another repository
10. As a colleague, I want to be told to add `.factory/` to the project's `.gitignore`, so that Run records do not end up in commits
11. As a colleague, I want a troubleshooting list for the usual failures (command not found, permission denied on the global folder, the install URL not found, wrong Node version), so that I can fix them without asking
12. As a colleague, I want a short picture of the Flow before the details, so that I know what is coming
13. As a colleague, I want to see what to type to start a Run, so that I can try it on a small task first
14. As a colleague, I want to know which questions the agent asks in Define and that it waits for my answers, so that I am not surprised
15. As a colleague, I want to know what happens without me (Spec, Tickets, Build, Check, pull request), so that I know when to leave it alone
16. As a colleague, I want to know when a Run stops and asks me something, so that I notice it needs me
17. As a colleague, I want to know how to open the Dashboard and read a card, so that I can follow several Runs
18. As a colleague, I want to know how to stop or redirect a Run, so that I stay in control
19. As a colleague, I want to know what the pull request contains and what to check before merging, so that I merge with confidence
20. As a colleague, I want a table of the terms I will see (Run, Stage, Spec, Ticket, Check axis), so that the words are clear
21. As a colleague, I want the guides reachable from the README top, so that I find them first
22. As the maintainer, I want the guides to tell the truth about commands, so that a renamed command or link fails a test instead of silently rotting

## Implementation Decisions

- The guides are Markdown files in `docs/`, written in English, linked from the README directly under the opening paragraph. The README keeps its Flow and CLI reference.
- The install guide covers: prerequisites (Node 20+, git, an authenticated `gh`, one agent) each with a check command; the install and update command from ADR 0005; `tds-factory --version`; `tds-factory install` and where it writes for each agent; preparing a project (`/setup-matt-pocock-skills`, `.factory/` in `.gitignore`); troubleshooting.
- GitHub Copilot comes first. Plain `tds-factory install` writes to the Claude and Codex folders, which Copilot also reads; `tds-factory install --agent copilot` writes to the Copilot folder. In Copilot the user starts a skill by typing `/` in the chat and choosing it, or by naming it in the request; `/skills` opens the skills menu. Claude and Codex get a short table and no walkthrough.
- The usage guide covers: the Flow in one picture; starting a Run with an example; the Define questions and the pause for answers; what runs unattended; when a Run waits for the user; the Dashboard (`tds-factory dashboard`, reading a card, the Run detail panel, "Needs you"); stopping or redirecting; the pull request and what to check; a glossary table of the terms.
- `setup-matt-pocock-skills` is added to `skills.manifest.json` and synced into `skills/`, so `tds-factory install` installs it. ADR 0001 already covers committed skill copies.
- The guides describe the public state of the repository. The install URL works only once the repository is public, and the PR says so.
- No new glossary term and no ADR: the guides reuse existing terms.
- Copilot's handling of read-only subagents (used by Check) is not verified; the guides do not promise it.

## Testing Decisions

- A good test checks what a colleague would hit: a dead link, a command that does not exist, a missing file. It does not check wording.
- Seams: the existing skills test seam (the manifest, the synced `skills/` folder and what `install` writes) for the new skill; one new docs seam that reads the README and `docs/*.md` for links and `tds-factory` commands.
- Skill shipping: `install` into a temporary home puts `setup-matt-pocock-skills` in each Agent target's directory, and the manifest and `skills/` agree.
- Docs seam: every relative Markdown link in the README and the two guides resolves to a file; the README links to both guides; every `tds-factory <command>` and `--agent` value shown in the guides is one the CLI knows; the guides contain no `setup.sh` as the main route.
- Prior art: `test/skills.test.js`, `test/sync.test.js`, `test/setup.test.js`, `test/readme-install.test.js`.

## Out of Scope

- Dutch translation.
- A Wiki, Pages site, video or screenshots.
- Per-agent walkthroughs for Claude Code and Codex.
- Changing the Flow, the Dashboard or the CLI.
- Making the repository public (the maintainer does that).
- Verifying how Copilot runs Check's subagents.
- A LICENSE or third-party notices (open from the release audit).

## Further Notes

- The skill-folder facts for Copilot come from the VS Code and GitHub Copilot documentation: project skills in `.github/skills`, `.claude/skills` and `.agents/skills`; personal skills in `~/.copilot/skills`, `~/.claude/skills` and `~/.agents/skills`. The GitHub cloud-agent page lists only `~/.copilot/skills` and `~/.agents/skills` for personal skills. The guide should therefore recommend `tds-factory install`, which also writes `~/.agents/skills`.
