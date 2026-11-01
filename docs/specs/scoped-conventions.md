## Problem Statement

Every Run reads all of the project's instruction guides at Preflight and gives them to the Standards and Security reviewers, however small the diff. A project with ten guides pays for all ten when the diff touches one folder. The Skill already says Standards receives the guides whose `applyTo` globs match the changed files, but no file says where a guide declares `applyTo`, nothing checks it, and Security gets no filtering. The 21 KB `skills/factory/SKILL.md` is also read in full for every Run, although the Fast track, Follow-up and the Invoked Skills overrides apply to some Stages only.

## Solution

An instruction guide declares its own path globs in its frontmatter, in Copilot's format (`applyTo`). Preflight reads `AGENTS.md` and the unscoped guides only. Before Check, a command matches the scoped guides against the diff, and Standards and Security receive the matching ones plus the unscoped ones. A new `doctor` check validates the guides. A command writes Claude Code rule copies (`.claude/rules/`) from the Copilot instruction files. The Factory Skill is split so that Stage-specific text lives in `references/`.

## User Stories

1. As a developer, I want a guide to declare `applyTo` globs in its own frontmatter, so that the scope lives next to the rules it scopes.
2. As a developer, I want a guide without `applyTo` to count as unscoped and be read for every Run, so that existing projects keep working.
3. As a Factory user, I want Preflight to read only `AGENTS.md` and the unscoped guides, so that a Run reads fewer instruction tokens.
4. As a Factory user, I want `tds-factory run guides --id <id>` to list the guides that apply to the Run's diff against its base, so that the coordinator never matches globs by hand.
5. As a Factory user, I want Standards and Security to receive only the matching and the unscoped guides, so that reviewers read less.
6. As a Factory user, I want Build to read a scoped guide when it first edits a file the guide matches, so that Build follows the rules Check will apply.
7. As a developer, I want `doctor` to fail on a linked guide that does not exist or has a malformed `applyTo`, naming the file and line, so that a typo does not silently drop a guide from review.
8. As a Claude Code user, I want `tds-factory rules` to write `.claude/rules/<name>.md` with `paths:` from each `.github/instructions/*.instructions.md`, so that Claude Code loads a guide only when it works on matching files.
9. As a maintainer, I want the generated rule copies committed like the Skill copies, so that they show up in diffs and work offline.
10. As a Factory user, I want the Fast track, Follow-up and the Invoked Skills overrides moved out of `SKILL.md` into `references/` that are read at the Stage that needs them, so that the Skill I always read is smaller.
11. As a maintainer, I want a test that keeps the router lines and the "Invoke" phrasing in `SKILL.md` and checks every reference it names exists, so that the split cannot break `sync` or `doctor`.

## Implementation Decisions

- **Declaration.** A guide is a Markdown file `AGENTS.md` or `CLAUDE.md` links to. Its frontmatter may hold `applyTo`: one glob or a comma-separated list, as Copilot reads it. Globs are repo-relative and matched with `path.matchesGlob`. No frontmatter or no `applyTo` means unscoped.
- **Run record.** `conventions` stays an array of paths and gets no new field. Globs are read from the guides at Check, so a change to a guide mid-Run is respected.
- **Preflight.** Reads `AGENTS.md` and the unscoped guides. For a scoped guide it records the path in `conventions` without reading it.
- **Check.** `run guides --id <id>` takes the guides recorded in `conventions` and prints those that apply: the unscoped ones and the scoped ones whose globs match a file in `git diff --name-only <base_sha>`. The coordinator gives these to Standards and Security. Reviewers receive no other guide.
- **Build.** The Skill tells Build to read a scoped guide at the first edit of a file it matches. Not enforced.
- **Doctor.** A new shared check `guides` (`pass` or `fail`): every linked guide exists, and its `applyTo`, when present, is valid. A guide without `applyTo` passes.
- **Native copies.** The Copilot source is `.github/instructions/*.instructions.md`. `tds-factory rules` converts `applyTo` to `paths:` and writes `.claude/rules/<name>.md`. It replaces only files it wrote (marker comment) and keeps a file the user edited, like install does. Codex gets no copy: it keeps the root `AGENTS.md`.
- **Skill split.** `SKILL.md` keeps Preflight, the Run record, Waiting, Stage agents, the Tracks rule and a one-line router per Stage. New `references/fast-track.md`, `references/invoked-skills.md`; Follow-up already has `references/follow-up.md`. Text moves unchanged unless this Spec says otherwise.
- **ADR.** One new ADR: guides declare their own path globs; Claude copies are generated; Codex gets none.

## Testing Decisions

- A unit test for the glob matcher and frontmatter parser (scoped, unscoped, list, malformed).
- A CLI test for `run guides` against a Run with a base and a diff.
- A `doctor` test for the `guides` check.
- A test for `rules`: conversion, marker, user-edited file kept.
- A skills test for the split: `SKILL.md` size is smaller than before, router lines present, every named reference exists, and `sync` still finds the invoked Skills.

## Out of Scope

- Enforcing that Build reads a guide.
- A Codex copy of the guides.
- Scoping `GLOSSARY.md`, ADRs or the Factory's own docs.
- Scoping the canonical specs.
