# TDS Factory

TDS Factory is a small software factory. It installs a set of skills into Claude, Codex and Copilot, and one of those skills, `factory`, walks a piece of work from idea to pull request.

**New here?** Read the [install guide](docs/install.md) to set the Factory up, then the [usage guide](docs/usage.md) to run your first piece of work. Run `tds-factory doctor` in a project first: it checks, without changing anything, whether the project is ready for a Run.

## The flow

A Run is one pass through four Stages, after a Preflight (`tds-factory doctor` runs its checks). Start it with the `factory` skill (`/factory`).

```mermaid
flowchart TB
    subgraph Preflight
        P[conventions and Verify command, asks you if it is missing]
    end
    subgraph Define
        A[grill-with-docs] --> B[to-spec] --> C[to-tickets]
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
    C --> E --> F
    F -->|problems found, fewer than 2 loops so far| E
    F -->|clean| G
    F -.->|not clean, or loop cap reached: ask first| G
```

Each Stage's result: Define writes a Spec in `docs/specs/` and a Ticket per task in the project's Issue tracker; Build finishes every Ticket test-first, one commit each, building what the Ticket asks and naming any smaller option in one line in `build.md`; Check gives a Standards, a Spec, a Security and an Infrastructure verdict (Infrastructure is skipped when no infrastructure file changed), each from a fresh read-only subagent; Finish opens the pull request.

The rules for each Stage live in [`skills/factory/SKILL.md`](skills/factory/SKILL.md). In short: only a clean Check goes on to Finish without asking, and Check sends the Run back to Build at most twice.

Agents need `tds-factory` on PATH to create and update the Run record (`run.json`, in `.factory/runs/<id>/`, plus a Markdown summary per Stage). Every Run works in its own Run worktree in `.factory/worktrees/<run id>`, on a branch named after the Run id, cut from the freshly fetched default branch of `origin`, so agents in separate tabs never share files. Run records always live in the main checkout, so one Dashboard shows every Run. Dependencies are not installed for you: run the project's normal setup in the worktree.

### Default models per Stage

`tds-factory install` writes four Stage agents per target (`factory-define`, `factory-build`, `factory-check`, `factory-finish`) next to the skills: `~/.claude/agents`, `~/.codex/agents` and `~/.copilot/agents` (`.github/agents` with `--project` for Copilot). `factory-define` does the Define Stage. The main agent stays the coordinator: it talks to you, owns the Run record and approvals, and runs the Check reviews as three or four independent read-only agents. Each cell is model and reasoning effort; "default" means the session setting applies and "not set" means Copilot has no effort setting.

| Stage | Claude | Codex | Copilot |
|---|---|---|---|
| Define | Sonnet, high | `gpt-6.1-sol`, medium | `claude-sonnet-5.5`, not set |
| Build | Sonnet, medium | `gpt-6.1-terra`, medium | `gpt-5.3-codex`, not set |
| Check | Opus, high | `gpt-6.1-sol`, high | `claude-sonnet-5.5`, not set |
| Finish | Haiku, low | `gpt-6-luna`, medium | `claude-haiku-4.5`, not set |

What each Agent target can guarantee, such as how read-only the Check agents are, is in the [capability matrix](docs/capabilities.md).

Edit the agent files to change a model. The Copilot agents set no `modelPolicy`, so a model your plan does not offer is replaced by the session model with a warning when you start the agent directly, but Copilot refuses to dispatch it as a subagent, which is how the Factory uses it. Check `/model` in Copilot CLI for the ids your plan offers and edit `model:` to match. Install updates agent files you have not edited and keeps ones you have; `--force` replaces those with the defaults too. Agent files from an install that predates this count as edited, so use `--force` once. Whether a model is available depends on your client, account and policy, and the client may substitute another or not report which one ran; the Factory reports such cases instead of assuming. The Copilot defaults were checked by dispatching against Copilot CLI 1.0.105 with one plan's model list, not against other Copilot environments or plans.

To see whether an agent follows the Flow, run the on-demand [agent evaluation](docs/evaluation.md).

## Setup

You need Node 20 or newer. Install the latest Release with one command, the same on macOS, Linux and Windows:

```sh
npm install -g --allow-remote=root https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz
tds-factory install
```

The `--allow-remote=root` flag is needed because npm 12 refuses URL installs by default. Run the same `npm install` command again to update, then `tds-factory install` to refresh the skills. `tds-factory --version` shows the installed version. Skills are not installed automatically by `npm install`; you run `tds-factory install` yourself, and again after every update, because the installed `factory` Skill must use the same Run commands as the CLI. Maintainers publish Releases manually; see the [release guide](docs/releasing.md).

### Working from a checkout

To work on the Factory itself, clone with `--recurse-submodules` and run `node scripts/dev-install.js`. It is all a new development machine needs, and you run it again after every merged PR. It prints each step and ends with a summary:

1. checks Node, git, npm and the checkout;
2. initialises the `vendor/` submodules;
3. fetches `origin`, packs its default branch and installs that globally, so you use what is on `master` instead of the last Release (your checkout and working tree are not touched);
4. registers the Factory with `tds-factory install`, which puts the skills and agents in `~/.claude` and `~/.agents`;
5. checks the result with `tds-factory doctor` (findings are warnings);
6. registers the developer skills described below.

A failing step skips the steps that depend on it; the others still run, and the exit code is non-zero if a step failed. Options: `--dry-run` shows what would happen and changes nothing, `--force` replaces skills it did not install, `--skip-dev-skills` leaves out step 6.

```sh
node bin/tds-factory.js sync       # copy the skills in skills.manifest.json from vendor/ into skills/
node bin/tds-factory.js install    # install skills/ into ~/.claude/skills and ~/.agents/skills
node bin/tds-factory.js dashboard  # serve the Runs of ./.factory on a per-repo port (printed at start)
```

`sync` validates every manifest entry (name, paths inside the repository, no symlinks, no duplicate names) before it writes any. It replaces each skill folder through a staging folder and a rename, so a failure leaves the old folder intact, and it refuses to replace a synced skill you edited by hand (`--force` overrides). It also writes `skills/PROVENANCE.json`: per skill the source path, upstream URL and commit, transformations, licence and attribution.

Run the tests with `npm test`. They use `node:test`.

### Developer skills

Besides the skills the Factory ships, a few skills help while developing the Factory itself. They are not in `skills.manifest.json`, so users do not get them. `scripts/dev-install.js` (step 6) copies them from `vendor/` to `~/.claude/skills` and `~/.agents/skills`, which Claude, Codex and Copilot all read. It only replaces skills it installed earlier (marked `.tds-factory-dev`) and skips same-named skills from other tools. `docs-sync-audit` and `test-gap-audit` need `python3`; `webapp-testing` needs Playwright. To change the set, edit `DEV_SKILLS` in the script.

| Skill | Use it to |
|---|---|
| `docs-sync-audit` | Check that the README, `docs/` and the agent tables still match the code after a change. |
| `test-gap-audit` | Find untested paths in `sync`, `install`, `run-store` and `doctor`. |
| `github-actions-hardening` | Review `.github/workflows/` (the Release workflow publishes on every merge). |
| `statechart` | Draw the Run state machine to spot missing or illegal transitions (ADR 0006). |
| `blast-radius` | List what a change to a Stage agent or the `factory` skill touches: three agent formats, committed skill copies, tests, docs. |
| `agentic-eval`, `eval-driven-dev` | Write new `eval/` scenarios and judge agent results. |
| `webapp-testing` | Test the Dashboard in a browser (theme, scroll, layout, header, logo). |
| `principle-make-operations-idempotent` | Keep `install`, `sync` and `dev-install` safe to re-run. |
| `principle-prove-it-works`, `principle-test-behavior-not-implementation` | Guide Build and Check: prove behaviour, do not test internals. |
| `github-release`, `conventional-commit` | Write release notes for the per-merge Releases and consistent commit messages. |
| `create-agentsmd` | Flesh out `AGENTS.md` with build, test and architecture hints. |

### Install options

| Option | Effect |
|---|---|
| `--agent claude\|codex\|copilot\|all` | Pick the Agent target. `all` is the default and means Claude plus Codex, because Copilot reads both directories. |
| `--project` | Install into the current directory instead of the user-global directory. |
| `--force` | Overwrite skill folders that tds-factory did not install or that you edited. |
| `--dry-run` | Print what install would do and change nothing. |

| Agent | Project directory | Global directory |
|---|---|---|
| claude | `.claude/skills` | `~/.claude/skills` |
| codex | `.agents/skills` | `~/.agents/skills` |
| copilot | `.github/skills` | `~/.copilot/skills` |

After you change a skill in `skills/`, run `install` again so the installed copy matches. `install` also removes folders it installed earlier that are no longer in `skills/` (it prints a `removed` line for each) and never touches folders without the tds-factory marker.

## Dashboard

`tds-factory dashboard` serves every Run of the repository on 127.0.0.1, one card per Run in a column per Stage. See the [Dashboard guide](docs/dashboard.md) for what it shows, which routes it serves and how a Run is deleted.

Add `.factory/` to the `.gitignore` of any project you run the factory in.

## Skills

The skills come from four upstream sources.

- [mattpocock/skills](https://github.com/mattpocock/skills)
- [backnotprop/pstack](https://github.com/backnotprop/pstack/tree/main/skills/unslop), which provides `unslop`
- [github/awesome-copilot](https://github.com/github/awesome-copilot/tree/main/skills/security-review), which provides `security-scan` (its `security-review` skill, renamed)

The upstream repos are git submodules in `vendor/`. `skills/` holds committed copies of the skills the factory uses, so a change upstream shows up in a diff before it reaches you. See `docs/adr/0001-committed-skill-copies.md`.

## Known limitations

- The installer copies skills unchanged. Codex ignores the Claude-only `disable-model-invocation` frontmatter, so Codex may invoke user-only skills such as `factory` on its own.

## License

MIT, see [LICENSE](LICENSE). The skills come from other MIT projects; their notices are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Documentation

- [Install guide](docs/install.md): set the Factory up and prepare a project.
- [Usage guide](docs/usage.md): run a piece of work from idea to pull request.
- [Dashboard guide](docs/dashboard.md): the page that shows every Run.
- [Capability matrix](docs/capabilities.md): what each Agent target guarantees.
- [Agent evaluation](docs/evaluation.md): test an agent against the Flow.
- [Release guide](docs/releasing.md): how maintainers publish a Release.
- [`GLOSSARY.md`](GLOSSARY.md): the terms used here (Run, Stage, Spec, Ticket and others).
- [`docs/adr/`](docs/adr/): design decisions.
