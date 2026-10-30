# Develop the Factory

This guide is for people who work on the Factory itself. To use the Factory, see the [install guide](install.md).

## Working from a checkout

To work on the Factory itself, clone with `--recurse-submodules` and run `node scripts/dev-install.js`. It is all a new development machine needs, and you run it again after every merged PR. It prints each step and ends with a summary:

1. checks Node, git, npm and the checkout;
2. initialises the `vendor/` submodules;
3. fetches `origin`, packs its default branch and installs that globally, so you use what is on `main` instead of the last Release (your checkout and working tree are not touched);
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

`scripts/doc-checks.js` holds the mechanical checks on the repository itself, which `test/doc-checks.test.js` runs: relative Markdown links resolve, ADR numbers are unique, a change to `src/`, `skills/` or `agents/` has a changelog fragment, the docs use no glossary Avoid term, the docs state the Check loop limit as the code does, and a test that calls `openPage` is named `*-browser.test.js` so CI's browser job runs it. The fragment check compares with `origin/main` and is skipped, with a reason, when that ref does not exist or shares no history with your branch, as in a shallow CI checkout; any other git failure fails the test. When you add a statement of a constant to the docs, add its pattern to `CONSTANTS`.

PRs and pushes to `main` run the full suite on Linux with Node 20, 22, 24 and the latest LTS, and on macOS with the latest LTS. Browser tests run separately on Linux and fail if Chrome or ChromeDriver is missing. Packaged CLI installation is checked on Linux, macOS and Windows; the full suite currently uses Unix shell fixtures, so it is not run on Windows. CI also validates the workflows with `actionlint`, lints the Bootstrap installers with `shellcheck` and PSScriptAnalyzer, and runs `install.ps1` against stub `node` and `npm` on Windows PowerShell 5.1 and 7.

The `ci-ok` job succeeds only when all the other jobs do. The `main` ruleset requires it, so a PR cannot merge while CI is red. When you add a CI job, add it to `needs` of `ci-ok`.

Run these checks individually with `npm run test:unit`, `npm run test:browser` and `npm run test:package`. Set `REQUIRE_BROWSER=1` to make a missing browser fail locally too. The package check uses temporary directories and verifies project installs for all three Agent targets.

## Switching between the Release and your checkout

Only one `tds-factory` is installed globally, and `tds-factory install` writes one set of skills and agents to `~/.claude`. You use whichever you installed last. Two scripts switch between them. Each removes the other version first, installs its own and runs `tds-factory install --force`, so the CLI and the skills always match:

```sh
sh scripts/use-official.sh   # the latest Release from GitHub
sh scripts/use-repo.sh       # this checkout, including uncommitted changes
```

`use-repo.sh` differs from `dev-install.js`, which installs the default branch of `origin`. Both scripts replace skills you edited by hand, like `install --force` does.

To see which one you use, run `tds-factory --version` and `which -a tds-factory`. The first entry wins. A checkout and a Release can share a version number, so bump `package.json` if you need to tell them apart.

## Developer skills

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
