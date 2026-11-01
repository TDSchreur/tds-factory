### Added
- An instruction guide can declare `applyTo` globs in its frontmatter. Preflight reads only `AGENTS.md` and the unscoped guides, `tds-factory run guides --id ID` lists the guides that apply to a Run's diff, and the Standards and Security reviewers receive only those.
- `tds-factory doctor` has a `guides` check that fails on a linked guide that is missing or has a malformed `applyTo`.
- `tds-factory rules` writes `.claude/rules/` copies of `.github/instructions/*.instructions.md`, with `applyTo` turned into `paths:`, and keeps a copy you edited unless `--force`, and never writes through a symbolic link.

### Changed
- The Factory Skill is smaller: the Fast track, the Define label lookup, the Invoked Skills overrides and the Finish steps moved to `references/` and are read when that Stage needs them. `sync` finds the Skills the Factory invokes in the references too.
