# Ponytail lite in Prepare

## Problem Statement

The Prepare Stage invokes `ponytail` at its default level, full. Full mode pushes Build to shrink the work on its own, which can cut against Tickets the Spec already settled. I want Build to deliver what the Ticket asked for, and to hear about a smaller option only as a one-line note.

## Solution

The Prepare Stage invokes `ponytail` in lite mode. Build then builds what was asked and names the smaller option in one line, instead of acting on it. The README's stage table shows that Prepare runs `ponytail` in lite mode.

## User Stories

1. As a developer running the Factory, I want Prepare to start `ponytail` in lite mode, so that Build implements the Tickets as written
2. As a developer, I want Build to name a smaller option in one line, so that I can still choose the simpler route
3. As a developer, I want the lite level to apply on every Agent target, so that a Run behaves the same under `claude`, `codex` and `copilot`
4. As a developer, I want the README stage table to say Prepare runs lite, so that the docs match what the Factory does
5. As a maintainer, I want the Prepare line to keep the ``Invoke `ponytail` `` wording, so that `sync` and the skills test still find the invoked Skill
6. As a maintainer, I want the vendored `ponytail` skill left alone, so that a re-sync never overwrites our change

## Implementation Decisions

- The `factory` Skill's Prepare Stage keeps one ``Invoke `ponytail` `` line, now stating lite mode and passing `lite` as the argument.
- The README's Prepare row marks `ponytail` as lite.
- The `ponytail` skill is not edited. It already supports the lite level.
- No other Stage, glossary entry or ADR changes. The change is easy to reverse and has no real alternative worth recording.

## Testing Decisions

- A good test checks external behavior: what the installed `factory` Skill tells the agent, not how the text is laid out.
- The existing skills test, which checks the Skills that `factory` invokes, is the seam. One check there asserts that the Prepare line asks for lite mode.
- Prior art: the `expected` Skills list in the skills test.

## Out of Scope

- Changing ponytail's levels or behavior
- Making the level configurable per project or per Run
- Other Stages

## Further Notes

Run `tds-factory install` after merging so the installed copy of `factory` updates.
