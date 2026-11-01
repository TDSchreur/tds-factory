# Instruction guides declare their own path globs

Every Run read all instruction guides and gave them to the Standards and Security axes. A guide now declares `applyTo` globs in its own frontmatter, in Copilot's format, and a guide without them is unscoped. Preflight reads only `AGENTS.md` and the unscoped guides, and `tds-factory run guides` lists the guides for a Run's diff, which the coordinator gives to the reviewers.

We put the globs in the guide, not in a routing line in `AGENTS.md`, so the scope sits next to the rules it scopes and cannot drift from them, and Copilot reads the same file in place. We keep `conventions` an array of paths and read the globs again at Check, so a guide that changes during a Run is respected.

Claude Code reads `.claude/rules/*.md` with `paths:`, so `tds-factory rules` generates those files from `.github/instructions/*.instructions.md` and they are committed, like the Skill copies in [ADR 0001](0001-committed-skill-copies.md). Codex only reads nested `AGENTS.md` files and has no globs, so it gets no copy; Check scoping covers it.
