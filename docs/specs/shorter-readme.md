# Shorter README with Setup near the top

## Problem Statement

The README is 181 lines. Setup starts at line 59, below the flow diagram and a model table, so a new reader has to scroll to find how to install. "Working from a checkout", the developer skills table and the CI notes are for people who work on the Factory itself, yet they sit in the middle of the user-facing Setup.

## Solution

Keep the README as a short overview for users: Setup directly under the opening paragraph, then the flow. Move contributor material to a new `docs/development.md`, and reference material (default models per Stage, install options) to the guides that already own those topics.

## User Stories

1. As a new reader, I want Setup right after the introduction, so that I can install without scrolling.
2. As a user, I want the README free of contributor instructions, so that I only read what applies to me.
3. As a contributor, I want "Working from a checkout", the developer skills and the test and CI notes in one development guide, so that I find them in one place.
4. As a reader, I want the model table and install options in the capability matrix and install guide, so that the README stays short.

## Implementation Decisions

- README order: introduction, Setup, The flow, Dashboard, Skills, Known limitations, License, Documentation.
- Setup keeps the two one-liners, the manual commands and the update paragraph.
- `docs/development.md` holds "Working from a checkout", "Developer skills" and the test and CI paragraphs, unchanged in content.
- "Default models per Stage" moves to `docs/capabilities.md`; the "Install options" tables move into `docs/install.md`.
- The README links to the new and extended guides from the Documentation list and where it dropped a section.

## Testing Decisions

- `test/readme-install.test.js` slices Setup up to the next `##` heading and no longer expects the checkout route inside the README.
- `test/guides.test.js` also checks links and commands in `docs/development.md`.
- `npm test` passes.

## Out of Scope

Changing what any section says beyond moving it.
