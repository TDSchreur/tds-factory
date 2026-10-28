# TDS Factory

TDS Factory is a small software factory. It installs a set of skills into Claude, Codex and Copilot, and one of those skills, `factory`, walks a piece of work from idea to pull request.

It is inspired by [zazencodes software-factory-claude-code](https://github.com/zazencodes/zazencodes-season-3/tree/main/src/software-factory-claude-code) and [super-board](https://github.com/EricTechPro/super-board).

## The flow

A Run is one pass through five Stages, after a Preflight. Start it with the `factory` skill (`/factory`).

```mermaid
flowchart LR
    subgraph Preflight
        P[conventions and verify command]
    end
    subgraph Define
        A[grill-with-docs] --> B[to-spec] --> C[to-tickets]
    end
    subgraph Prepare
        D[ponytail]
    end
    subgraph Build
        E[implement-spec with tdd]
    end
    subgraph Check
        F[code-review, security-scan, infrastructure]
    end
    subgraph Finish
        G[pr] --> H[unslop]
    end

    P --> A
    C --> D --> E --> F
    F -->|problems found, fewer than 2 loops so far| E
    F -->|clean, or loop cap reached| G
    F -.->|infrastructure fail: ask first| G
```

| Stage | Skills | Result |
|---|---|---|
| Define | `grill-with-docs`, `to-spec`, `to-tickets` | A Spec in `docs/specs/` and a Ticket per task in the project's Issue tracker |
| Prepare | `ponytail` | Build writes the minimum code that works |
| Build | `implement-spec`, `tdd` | Every Ticket done, test-first |
| Check | `code-review`, `security-scan` | A Standards, a Spec, a Security and an Infrastructure verdict |
| Finish | `pr`, `unslop` | A prepared pull request |

Preflight reads the project's conventions (`AGENTS.md` or `CLAUDE.md`, the instruction guides it routes to and the canonical specs it lists) and finds the verify command in its `## Commands` section. If there is none, it asks you once and never guesses. Build runs the verify command after each Ticket. Check gives the Standards review the guides whose `applyTo` globs match the changed files and flags a canonical spec left stale, and gives the Security review the project's "Universal safeguards".

Check sends the Run back to Build at most twice, for `code-review` problems worth fixing or any CRITICAL, HIGH or MEDIUM security or infrastructure finding. After that it reports what is still open and moves on to Finish. The Infrastructure axis runs only when the diff changes Bicep, Azure Pipelines or `bicepconfig.json` files, otherwise it is `skipped`. It runs `bicep build` and `bicep lint`, checks pipeline YAML for plaintext secrets, unpinned versions and missing approval gates on production stages, and never deploys. If it cannot validate a file it says "not validated", never pass. Infrastructure is the one axis that blocks Finish: on `fail` or "not validated" the skill asks whether to accept the risk and prepares the PR only after a yes. The skill never pushes or opens the PR without your go-ahead.

Build works on a branch named after the Run, one commit per Ticket, and runs inline. Check runs each review in a fresh read-only subagent, so the reviewer did not write the code. Finish saves the PR draft as `pr.md` in the Run folder, and fills in the project's PR template (`.github/`, `.azuredevops/` or `docs/pull_request_template.md`) when there is one, including its Infrastructure checklist. When the tracker is GitHub the body closes every Ticket with `Closes #N`; otherwise it lists the Ticket paths and has no `Closes` lines.

Each Run keeps a `run.json` record in `.factory/runs/<id>/`, plus a short Markdown summary per Stage. The Dashboard reads these. Besides the verdicts (`standards`, `spec`, `security`, `infrastructure`), `run.json` holds `commands` (the verify command) and `conventions` (the paths Preflight read).

## Setup

You need Node 20 or newer. Clone with `--recurse-submodules`, or run `git submodule update --init` afterwards.

```sh
node bin/tds-factory.js sync       # copy the skills in skills.manifest.json from vendor/ into skills/
node bin/tds-factory.js install    # install skills/ into ~/.claude/skills and ~/.agents/skills
node bin/tds-factory.js dashboard  # serve the Runs of ./.factory on http://127.0.0.1:4317
```

`sync` refuses a manifest entry whose shipped name is not lowercase letters, digits and hyphens, whose source or destination leaves the repository or `skills/`, or is the repository root or inside `skills/`, or whose source is or sits under a symlink, or whose skill folder contains one, or that ships under the same name as an earlier entry. It validates every entry before it writes any.

Run the tests with `npm test`. They use `node:test`.

### Install options

| Option | Effect |
|---|---|
| `--agent claude\|codex\|copilot\|all` | Pick the Agent target. `all` is the default and means Claude plus Codex, because Copilot reads both directories. |
| `--project` | Install into the current directory instead of the user-global directory. |
| `--force` | Overwrite skill folders that tds-factory did not install. |

| Agent | Project directory | Global directory |
|---|---|---|
| claude | `.claude/skills` | `~/.claude/skills` |
| codex | `.agents/skills` | `~/.agents/skills` |
| copilot | `.github/skills` | `~/.copilot/skills` |

After you change a skill in `skills/`, run `install` again so the installed copy matches. `install` also removes folders it installed earlier that are no longer in `skills/` (it prints a `removed` line for each) and never touches folders without the tds-factory marker.

## Dashboard

`dashboard` serves the `.factory/` folder of the current directory, read-only, on 127.0.0.1. The default port is 4317, and `--port` changes it. It prints the URL when it starts.

| Route | Returns |
|---|---|
| `/` | The Dashboard page, with a card per Run in a column per Stage. Runs waiting on you are flagged. Check cards show a chip per verdict: Standards, Spec, Security and Infrastructure. |
| `/api/runs` | A JSON list of Run records. A record that cannot be read comes back with `unreadable: true`. |
| `/files/<run-id>/<name>.md` | A Markdown file from a Run folder. |

Add `.factory/` to the `.gitignore` of any project you run the factory in.

## Skills

The skills come from three upstream sources.

- [mattpocock/skills](https://github.com/mattpocock/skills)
- [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)
- [backnotprop/pstack](https://github.com/backnotprop/pstack/tree/main/skills/unslop), which provides `unslop`

The upstream repos are git submodules in `vendor/`. `skills/` holds committed copies of the skills the factory uses, so a change upstream shows up in a diff before it reaches you. See `docs/adr/0001-committed-skill-copies.md`.

## Known limitations

- The installer copies skills unchanged. Codex ignores the Claude-only `disable-model-invocation` frontmatter, so Codex may invoke user-only skills such as `factory` on its own.
- From ponytail, the installer copies only `SKILL.md`. Its hooks and slash commands are not installed.

## More

`GLOSSARY.md` defines the terms used here (Run, Stage, Spec, Ticket and others). Design decisions live in `docs/adr/`.
