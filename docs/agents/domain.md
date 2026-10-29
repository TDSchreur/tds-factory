# Domain Docs

This repo uses a **single-context** layout for domain knowledge:

- **GLOSSARY.md** at the repo root: shared vocabulary and definitions
- **ADRs** in `docs/adr/`: Architecture Decision Records explaining why key choices were made

## How to read domain docs

- When you encounter an unfamiliar term, check `GLOSSARY.md` first.
- When you're about to make an architectural choice or want to understand why something was built a certain way, look for a related ADR in `docs/adr/`.
- Update `GLOSSARY.md` and create ADRs as you learn and decide. Keep them current—they are part of the codebase, not external docs.

## Domain concepts

Key concepts in this repo:
- **Claude**: an Agent target, a coding agent the Factory installs skills into
- **Codex**: an Agent target
- **Copilot**: an Agent target
