The goal of this project is to create a (simple) software factory, inspired by;
- https://github.com/zazencodes/zazencodes-season-3/tree/main/src/software-factory-claude-code
- https://github.com/EricTechPro/super-board

It needs to install the skills needed in a way usable for:
- claude
- codex
- copilot

Skills we want to use:
- https://github.com/mattpocock/skills
- https://github.com/DietrichGebert/ponytail
- https://github.com/backnotprop/pstack/tree/main/skills/unslop

Basic flow:

Define:
1. grill-with-docs to define wath we have to do
2. to-spec to create the spec
3. to-tickets to create the tickets

Prepare:
- ponytail

Build:
- implement-spec
- tdd

Check:
- code-review
- loopt back to build if needed, max 2 times

Finish:
- prepare a PR

## Usage

Requires Node 20+. Clone with `--recurse-submodules` (or run `git submodule update --init`).

```sh
node bin/tds-factory.js sync      # copy the skills in skills.manifest.json from vendor/ into skills/
node bin/tds-factory.js install   # install skills/ into ~/.claude/skills and ~/.agents/skills
node bin/tds-factory.js dashboard # serve the Runs of ./.factory on http://127.0.0.1:4317
npm test                          # run the tests (node:test)
```

Options for `install`:

- `--agent claude|codex|copilot|all`: `all` (default) is claude + codex, because Copilot reads both directories
- `--project`: install into the current directory instead of the user-global directory
- `--force`: overwrite skill folders that were not installed by tds-factory

| Agent | Project | Global |
|---|---|---|
| claude | `.claude/skills` | `~/.claude/skills` |
| codex | `.agents/skills` | `~/.agents/skills` |
| copilot | `.github/skills` | `~/.copilot/skills` |

`dashboard` serves the `.factory/` folder of the current directory read-only on 127.0.0.1 (default port 4317, `--port` to change it) and prints the URL. Routes: `/` (the board page), `/api/runs` (JSON list of Run records; unreadable ones come back with `unreadable: true`) and `/files/<run-id>/<name>.md` (Markdown files of a Run). Each Run is a folder `.factory/runs/<id>/` with a `run.json` record.

Run the flow above with the `factory` skill (`/factory`).

`skills/` holds committed copies of the upstream skills, so changes to them show up in diffs (see `docs/adr/0001-committed-skill-copies.md`).

### Known limitations

- Skills are copied unchanged. Codex ignores the Claude-only `disable-model-invocation` frontmatter, so user-invoked skills such as `factory` may also be invoked by Codex on its own.
- From ponytail only `SKILL.md` is installed, not its hooks or slash commands.
