# Develop the Factory

This guide is for people who work on the Factory itself. To use the Factory, see the [install guide](install.md).

## Working from a checkout

To work on the Factory itself, clone with `--recurse-submodules` and run `node scripts/dev-install.js`. It is all a new development machine needs, and you run it again after every merged PR. It prints each step and ends with a summary:

1. checks Node, git, npm and the checkout;
2. initialises the `vendor/` submodules;
3. fetches `origin`, packs its default branch and installs that globally, so you use what is on `develop` instead of the last Release (your checkout and working tree are not touched);
4. registers the Factory with `tds-factory install`, which puts the skills and agents in `~/.claude` (or `$CLAUDE_CONFIG_DIR`) and `~/.agents`;
5. checks the result with `tds-factory doctor` (findings are warnings);
6. registers the developer skills described below.

A failing step skips the steps that depend on it; the others still run, and the exit code is non-zero if a step failed. Options: `--dry-run` shows what would happen and changes nothing, `--force` replaces skills it did not install, `--skip-dev-skills` leaves out step 6.

```sh
node bin/tds-factory.js sync       # copy the skills in skills.manifest.json from vendor/ into skills/
node bin/tds-factory.js install    # install skills/ into ~/.claude/skills ($CLAUDE_CONFIG_DIR/skills when set) and ~/.agents/skills
node bin/tds-factory.js dashboard  # serve the Runs of every registered Project on the shared port 4300 (a free port when it is busy; the URL is printed)
```

`sync` validates every manifest entry (name, paths inside the repository, no symlinks, no duplicate names) before it writes any. It replaces each skill folder through a staging folder and a rename, so a failure leaves the old folder intact, and it refuses to replace a synced skill you edited by hand (`--force` overrides). It also writes `skills/PROVENANCE.json`: per skill the source path, upstream URL and commit, transformations, licence and attribution.

Run the tests with `npm test`. They use `node:test`. Every test and eval script (`test`, `test:unit`, `test:browser`, `test:package` and `eval`) runs through `scripts/with-temp-dir.js`, which points `TMPDIR`, `TMP` and `TEMP` at one new folder, runs the command and removes the folder when the command ends or is interrupted. Tests make many temporary folders and do not remove them one by one, so a command that bypasses the runner (for example `node --test` directly) leaves them in the system temp directory until it is cleared. The shared `test/git-repo.js` helper removes its own folders when the test process exits and sets `TDS_FACTORY_CONFIG_DIR` when it is unset, so direct test runs never touch the user's real Project registry.

The `factory` Skill is `skills/factory/SKILL.md`, which holds what every Run needs, plus the files in `skills/factory/references/` that it names where they are needed (progress commands, the `run.json` schema, Stage agents, the Exit checklist, Check details, Follow-up, the Fast track, Define details (build or borrow, size, label lookup), Finish and the Invoked Skills overrides). `install` and `sync` ship the whole folder, `tds-factory doctor` checks that an installed copy has the reference files, and the Skill tests (`test/skill-text.js`) read the main file together with its references. Keep the main file under 18 KB: put detail in a reference file.

`scripts/doc-checks.js` holds the mechanical checks on the repository itself, which `test/doc-checks.test.js` runs: relative Markdown links resolve, ADR numbers are unique, a change to `src/`, `skills/` or `agents/` has a changelog fragment, the docs use no glossary Avoid term, the docs state the Check loop limit as the code does, and a test that calls `openPage` is named `*-browser.test.js` so CI's browser job runs it. The fragment check compares with `origin/develop` and is skipped, with a reason, when that ref does not exist or shares no history with your branch, as in a shallow CI checkout; any other git failure fails the test. When you add a statement of a constant to the docs, add its pattern to `CONSTANTS`.

PRs to and pushes to `develop` and `main` run the full suite on Linux with Node 24.4 and the latest LTS. CI has no macOS jobs, because GitHub's macOS runners queue unreliably. A Windows job runs `npm run check` and `npm run test:unit` with the latest LTS; the unit tests run in two shards (`npm run test:unit -- --test-shard=1/2`) and the first shard also runs the check, and on a pull request also runs each unit test file the PR changed three times (`scripts/repeat-changed-tests.js`), so a test that is only sometimes red fails the PR that adds it. Browser tests run separately on Linux and fail if Chrome or ChromeDriver is missing. Packaged CLI installation is checked on Linux and Windows. CI also validates the workflows with `actionlint`, lints every script under `scripts/` with `shellcheck` and PSScriptAnalyzer, and runs `install.ps1` against stub `node` and `npm` on PowerShell 7 on Windows.

## Working on Windows

The tests run on Windows with PowerShell 7 and Git for Windows. `.gitattributes` keeps every text file on LF, because the tests and the Skill checks split files on `\n`. After you pull the commit that adds it, check the working tree out again: `git rm --cached -r .` then `git reset --hard` (commit or stash your changes first). Run the tests through `npm test` or `npm run test:unit`, not `node --test` directly: the runner also puts `true` and `false` commands on PATH, which cmd.exe does not have.

Tests that need symbolic links, the executable bit, `mkfifo`, POSIX signals or file names Windows does not allow are skipped on Windows with a reason. Fake `gh` commands in tests come from `test/fake-command.js`, which on Windows makes a copy of `node.exe` that runs the fake's script.

The browser tests are not supported on Windows: every one of them skips there with a reason, also with `REQUIRE_BROWSER=1`. Run them on Linux or macOS (or in WSL) with `chromedriver` and Chromium or Chrome on PATH.

The `ci-ok` job succeeds only when all the other jobs do. The `develop` and `main` rulesets require it, so a PR cannot merge while CI is red. When you add a CI job, add it to `needs` of `ci-ok`.

Run these checks individually with `npm run test:unit`, `npm run test:browser` and `npm run test:package`. Set `REQUIRE_BROWSER=1` to make a missing browser fail locally too. The package check uses temporary directories and verifies project installs for all three Agent targets.

## Flaky tests

A test that fails now and then is a bug in the test, mostly because it sleeps a fixed time, shares a port, path or clock with another test, or assumes how Linux behaves. The rules are in the [reliable-tests guide](../.github/instructions/reliable-tests.instructions.md), and the `reliable-tests` Skill walks through diagnosing one. To reproduce a flake, run the file in a loop (`for i in $(seq 30); do node --test test/<file>.test.js || break; done`), again under CPU load and with `--test-concurrency=1`. Wait for a condition with `waitUntil` from `test/wait-until.js` instead of a sleep. Fix the cause: do not add a retry or raise a timeout without knowing why the old one was too short.

## JavaScript quality checks

For the development tools, use Node 24.4 or later, then run `npm ci`. The CLI itself supports Node 24.4 and later (the active LTS lines). Run `npm run check` to run all three checks below in one go. `npm run lint` checks every JavaScript file with ESLint. `npm run format:check` checks JavaScript, JSON, Markdown, YAML and the remaining CSS and HTML with Prettier (`.prettierrc.json`, `.editorconfig` matches it); `npm run format` rewrites the files. Vendored files and `.factory/` are excluded from both. `skills/`, `agents/` and `CHANGELOG.md` are synced or generated and stay out of the formatting check, as do `dashboard/index.html` and `dashboard/style.css`, whose source the Dashboard tests read with regular expressions. `git config blame.ignoreRevsFile .git-blame-ignore-revs` hides the formatting commits from `git blame`. There is no pre-commit hook: a hook would run on every commit the Factory makes in each Run worktree, and a failing hook would block them, so CI and `npm run check` are the gate.

CI runs the lint, formatting and type checks; `npm test` does not, so run `npm run check` before every Check. ESLint uses the recommended rules plus `eqeqeq`, `prefer-const`, `no-var` and `no-shadow`, with a few commented exceptions in its configuration. The project already checks workflows with actionlint, shell scripts with ShellCheck, PowerShell with PSScriptAnalyzer, and documentation with its own tests. Run `npm run typecheck` to check the JavaScript with TypeScript. It runs three plain `tsc -p` projects, one after the other: the root `tsconfig.json` (the root `*.js` files, `bin/`, `src/`, `scripts/` and `eval/`, ES2024 with the Node types), `dashboard/tsconfig.json` (the Dashboard page, ES2024 with the DOM libraries and no Node types, so browser code cannot use a Node API unnoticed) and `test/tsconfig.json` (every file in `test/`, ES2024 with the Node types and no DOM types: the browser tests hand the code that runs in the page to the driver as a string, so a Node-side test cannot use `document` or `window` unnoticed). All three projects use `strict` with `checkJs: true`, so every file is checked and none can opt out: no `// @ts-nocheck`, `@ts-ignore` or `@ts-expect-error`, and a test pins that for the production code and the tests alike. The types are JSDoc in the `.js` files; there is no build step and no emit, and the package ships the sources ([ADR 0029](adr/0029-jsdoc-and-checkjs-rather-than-a-typescript-migration.md)). To annotate a file, describe its parameters with `@param` and its results with `@returns`, import a type from another module with `@import { Run } from './run-record.js'`, and avoid a cast except where the code has already narrowed the value at run time; an explicit `any` needs a one-line reason. In a test, `test/run-view.js` builds a complete `RunView` or Run store entry from the fields a test names, and `fromJson` passes a value of the wrong shape through JSON where a test feeds it to the code on purpose. The Run record types (`Run`, `Verify`, `Metrics`, `FollowUp` and the rest of `run.json`) are typedefs in `src/run-record.js`. A caught value is `unknown`: read it with `messageOf`, `codeOf` and `isMissing` from `src/narrow.js`. The Dashboard cannot import the Run record types, because they pull in the Node types; `dashboard/model.js` declares the `RunView` shape that `interpretRun` in `src/dashboard-view.js` (`src/dashboard.js` re-exports it) returns, and `dashboard/modules.d.ts` types the vendored Preact and htm files. `vendor/`, `dashboard/vendor/` and `.factory/` are not checked, and a test fails when a tracked JavaScript file is covered by none of the three projects. Dependabot checks npm and GitHub Actions dependencies weekly. `npm audit` can identify dependency advisories; development dependencies are not shipped as runtime dependencies.

## Errors

An error that a caller has to tell apart from others is a `FactoryError` (`src/errors.js`) with a lowercase, kebab-case `code` and, when it replaces another error, that error as `cause`; the code can never be mistaken for a Node system error code such as `ENOENT`. Check `codeOf(err)`, not the message. A `catch` in `src/` either names the error and reacts to it, narrows to the codes it expects (`isMissing` for an absent path) and rethrows the rest, or has no variable and starts with a comment that says why ignoring the error is intended; `test/bare-catch.test.js` enforces the last rule. The HTTP requests of `tds-factory update` carry a timeout.

## Instruction guides

The instruction guides live in `.github/instructions/*.instructions.md`, each scoped with `applyTo`, and `AGENTS.md` links every one of them, which is how Codex and the Factory's reviewers find them. Claude Code reads the copies in `.claude/rules/`, which `tds-factory rules` writes from the guides. After you edit a guide, run `tds-factory rules` and commit the copy; a test fails when a guide is not linked or its copy is missing or out of date.

## Run store modules

`src/run-store.js` is the only module the CLI, the Dashboard and Doctor import. It exposes `openRunStore` and delegates to modules split by seam: `run-record.js` (field rules, the atomic write and the Run record typedefs), `run-folder.js` (Run folders, locks, listing), `worktrees.js` (worktree and origin facts), `evidence.js` (Verify, verdicts, project reviews and the Finish gate), `run-lifecycle.js` (start, update, transition, accept, sync, rework, complete, split, size), `run-events.js` (the append-only Event log of a Run, its bounded reader and the events a change stands for), `run-repair.js`, `run-clean.js`, `run-sweep.js` (the read-only term sweep) and `run-size.js` (the Run size without lockfiles and `test/fixtures/`, and the size warnings at the Check transition), plus `narrow.js` (`messageOf`, `codeOf`, `isMissing`, `oneOf` and `execFailure`, which read an `unknown` value, and which every module may import). Tests go through `openRunStore`. See [ADR 0012](adr/0012-run-store-is-split-by-seam.md).

The multi-Project Dashboard launch flow is split too: `src/project-registry.js` owns the Project registry, lock and Dashboard state file, and `src/dashboard-launch.js` decides whether to reuse a running shared Dashboard or start one and print the URL.

## Git

Every plain `git` call in `src/` goes through `git` (sync) or `gitAsync` (async) in `src/git.js`; `gitAsync` marks a real timeout with `timedOut` and gives a `maxBuffer` overflow its own code; only `src/sync.js` keeps its own `execFileSync` with `-C`. Run operations that the CLI and the Dashboard both use are written once as a flow of git steps and run sync or async ([ADR 0030](adr/0030-one-flow-of-git-steps-runs-sync-for-the-cli-and-async-for-the-dashboard.md)). The `gh` reads of Follow-up are steps of the same flow (`commandStep`; the adapter names the command), so the Dashboard's Fix does not block on them either.

## PR providers

Every call of the `gh` command lives in `src/pr-github.js`, the GitHub adapter behind `src/pr-provider.js`. `providerFor(url)` returns the adapter for a PR link and `remoteRepo(remote)` the adapter and repository of a git remote URL. The Dashboard, Run clean-up, Follow-up and Run repair ask the provider and judge the answer themselves, and a test pins that no other file runs `gh`. The plumbing both adapters share (the runner with its environment and buffer limit, the sync wrapper and the reason error) is in `src/pr-exec.js`, which names no command. The Dashboard's PR status is `statusAsync` in the adapter: `parseStatus` turns one `gh pr view` answer into the status, and `test/fixtures/pr-status/merged-real.json` is real output of it. `src/pr-azure.js` is the Azure DevOps adapter and the only file that runs `az`; it only reads (status, state and head, sync with `view` for the CLI and Doctor, async with `viewAsync` for the Dashboard's clean-up, `details` for Check PR, and the flows `strictViewFlow` and `observeFlow` for Follow-up and Fix; threads and statuses come from two `az devops invoke` GET calls addressed by GUIDs), `src/pr-text.js` holds the sanitising and caps both adapters share, `can(url, operation)` tells a caller which operations the adapter of a link has, `providerWith(url, ...operations)` returns the adapter typed with those operations or throws, and a test pins that it runs no write subcommand. Its fixtures in `test/fixtures/pr-status/azure/` are output recorded from the sandbox repository `Kahoot` (see the README there), and tests never call `az`. A new host is one more adapter in that list. See [ADR 0020](adr/0020-pr-providers-sit-behind-one-seam.md).

## Switching between the Release and your checkout

Only one `tds-factory` is installed globally, and `tds-factory install` writes one set of skills and agents to `~/.claude` (or `$CLAUDE_CONFIG_DIR`). You use whichever you installed last. Two scripts switch between them, in a shell version and a PowerShell 7 version. Each removes the other version first, installs its own and runs `tds-factory install --force`, so the CLI and the skills always match:

```sh
sh scripts/use-official.sh   # the latest Release from GitHub
sh scripts/use-repo.sh       # this checkout, including uncommitted changes
```

```powershell
./scripts/use-official.ps1   # the same, on Windows
./scripts/use-repo.ps1
```

`use-repo` differs from `dev-install.js`, which installs the default branch of `origin`. Both scripts replace skills you edited by hand, like `install --force` does.

To see which one you use, run `tds-factory --version` and `which -a tds-factory`. The first entry wins. A checkout and a Release can share a version number, so bump `package.json` if you need to tell them apart.

## Developer skills

Besides the skills the Factory ships, a few skills help while developing the Factory itself. They are not in `skills.manifest.json`, so users do not get them. `scripts/dev-install.js` (step 6) copies them from `vendor/` to `~/.claude/skills` (`$CLAUDE_CONFIG_DIR/skills` when set) and `~/.agents/skills`, which Claude, Codex and Copilot all read. It only replaces skills it installed earlier (marked `.tds-factory-dev`) and skips same-named skills from other tools. `docs-sync-audit` and `test-gap-audit` need `python3`; `webapp-testing` needs Playwright. To change the set, edit `DEV_SKILLS` in the script.

| Skill                                                                    | Use it to                                                                                                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `docs-sync-audit`                                                        | Check that the README, `docs/` and the agent tables still match the code after a change.                                      |
| `test-gap-audit`                                                         | Find untested paths in `sync`, `install`, `run-store` and `doctor`.                                                           |
| `github-actions-hardening`                                               | Review `.github/workflows/` (the Release workflow publishes on every merge).                                                  |
| `statechart`                                                             | Draw the Run state machine to spot missing or illegal transitions (ADR 0006).                                                 |
| `blast-radius`                                                           | List what a change to a Stage agent or the `factory` skill touches: three agent formats, committed skill copies, tests, docs. |
| `agentic-eval`, `eval-driven-dev`                                        | Write new `eval/` scenarios and judge agent results.                                                                          |
| `webapp-testing`                                                         | Test the Dashboard in a browser (theme, scroll, layout, header, logo).                                                        |
| `principle-make-operations-idempotent`                                   | Keep `install`, `sync` and `dev-install` safe to re-run.                                                                      |
| `principle-prove-it-works`, `principle-test-behavior-not-implementation` | Guide Build and Check: prove behaviour, do not test internals.                                                                |
| `github-release`, `conventional-commit`                                  | Write release notes for the per-merge Releases and consistent commit messages.                                                |
| `create-agentsmd`                                                        | Flesh out `AGENTS.md` with build, test and architecture hints.                                                                |
| `npm-trusted-publishing`                                                 | Move the Release workflow from a long-lived npm token to OIDC trusted publishing.                                             |
| `github-actions-runtime-upgrade-conventions`                             | Keep the Node and action versions in `.github/workflows/` current.                                                            |
| `agent-supply-chain`, `sandbox-npm-install`                              | Check the supply chain of what `install` and `dev-install` fetch, and try unknown npm packages in a sandbox.                  |
| `dependabot`                                                             | Review `.github/dependabot.yml` for npm and Actions updates.                                                                  |
