# Use destination selection in update and the Bootstrap installers

[Issue #568](https://github.com/TDSchreur/tds-factory/issues/568), Full track. Third of three Runs after the [cleanup foundation](install-destination-cleanup.md), the [selection foundation](install-destination-selection-foundation.md) and the [integration Spec](install-destination-selection-integration.md), which made `tds-factory install` ask for an Install selection.

> Scope as built: `install.ps1` (Ticket 4, user story 5 and the PowerShell variables of story 6) was left out of this Run and is unchanged; it still runs `tds-factory install` without a choice.

## Problem statement

`tds-factory update`, `scripts/install.sh`, `scripts/install.ps1` and `scripts/dev-install.js` still call `tds-factory install` without a choice. They work only in a terminal that can answer the prompt, and under `curl | sh`, `irm | iex` and in unattended use they cannot say where to install. `update` also cannot cancel before it has replaced the CLI.

## Solution

Every entry point reaches the same choice logic as `install`: an interactive prompt on the controlling terminal with saved choices preselected, or explicit flags, or an explicit `--reuse-selection`. Nothing is chosen silently, and without a terminal and without a choice the entry point fails with an example command. [ADR 0039](../adr/0039-update-chooses-destinations-before-upgrading-the-cli.md) records the ordering.

## User stories

1. As a user running `tds-factory update` in a terminal, I want to confirm or change the destinations before anything is downloaded, so that cancelling leaves the CLI, installed files and saved selection untouched.
2. As a user, I want the choice I made to be applied by the new CLI without a second question.
3. As a script author, I want `tds-factory update --agent claude,codex`, `--claude-dir PATH` and `--reuse-selection`, so that unattended updates are explicit; with no terminal and no choice I want a failure with an example before any download.
4. As a user running `curl ... | sh`, I want the question on my terminal although stdin is the script, and cancelling to leave skills, agents and saved choices unchanged (the CLI may already be installed).
5. As a user running `pwsh -c "irm ... | iex"`, I want the same question on the console.
6. As a script author, I want `sh -s -- --agent claude` and `TDS_FACTORY_AGENT`, `TDS_FACTORY_CLAUDE_DIR` and `TDS_FACTORY_REUSE=1` for unattended Bootstrap, with PowerShell using only the variables.
7. As a Factory developer, I want `node scripts/dev-install.js --agent claude --claude-dir PATH` or `--reuse-selection` to reach `tds-factory install`.
8. As a user, I want checksum, retry and never-downgrade behavior unchanged, and `--force` and `TDS_FACTORY_FORCE` documented.

## Implementation decisions

- **Resolve-then-pass seam.** `src/install.js` exposes a function that runs the existing selection resolution (`explicitDestinations`, saved record, `chooseDestinations`) and returns the chosen destinations or `undefined` for a cancellation, plus a serializer from destinations to `install` flags (`--agent a,b`, repeatable `--claude-dir`). `runInstall` uses the first part. The round trip of every destination the prompt can produce (default Claude folder, extra Claude folders, Codex, Copilot) must be lossless; a destination the flags cannot express is a defect to fix in the flags, not a reason to prompt twice. `update` is global only; `--project` is not added to `update`.
- **Update order.** `update` resolves the choice first (flags, then prompt, then the no-terminal failure `install-selection-required`), then runs the existing version lookup, no-downgrade check, download, checksum and `npm install -g`, then `tds-factory install` with the serialized flags (and `--force` unless `--no-force`). Cancellation, no terminal and invalid flags exit before the first network call. When the installed version is already current, the selection is still resolved and the install step still runs, as today. `update` accepts the `install` flags plus `--no-force`; `--reuse-selection` is never the default. The first update from a CLI without this change chooses after the upgrade; the docs say so.
- **Bootstrap installers.** Both scripts stay thin and translate into `tds-factory install` flags without validating them. Variables: `TDS_FACTORY_AGENT` (value of `--agent`), `TDS_FACTORY_CLAUDE_DIR` (a list of folders separated by the platform path-list separator, `:` in `install.sh` and `;` in `install.ps1`; an empty entry is an error), `TDS_FACTORY_REUSE=1`. `install.sh` also forwards its own arguments (`sh -s -- --agent claude`). Giving a choice both as arguments and as variables, or an empty list entry, is rejected by the script before npm runs; every other combination (`--reuse-selection` with `--agent`, `--claude-dir` without Claude) is rejected by the CLI before it changes anything. `TDS_FACTORY_FORCE` and `TDS_FACTORY_SKIP_SKILLS` stay. Interactive input comes from the CLI's terminal (`/dev/tty`, `CONIN$`), so the scripts never read stdin; without a terminal the CLI's failure with an example command is shown.
- **dev-install.** `scripts/dev-install.js` accepts `--agent`, `--claude-dir` (repeatable) and `--reuse-selection` and appends them to its `tds-factory install` call. Its own dev-skill copying and `--force` stay as they are.
- **Force semantics.** `update` replaces edited files with `--force` by default (`--no-force` keeps them); the Bootstrap installers keep it opt-in through `TDS_FACTORY_FORCE=1`; `dev-install.js --force` is unchanged. The documents state this once, side by side.
- **Build or borrow.** No new security-sensitive primitive: path-list splitting is a plain split, and all validation stays in the CLI.
- **Platforms.** Linux and Windows only; macOS is refused as in the integration Spec.
- **Documents:** `docs/install.md`, `README.md`, `docs/specs/one-line-installers.md` (its Limits section and the Bootstrap, Skills and Update decisions), `docs/specs/install-destination-selection-integration.md` and `docs/specs/install-destination-cleanup.md` (the "until #568" statements), `docs/adr/0037-install-selections-own-destination-cleanup.md` (the status line), `docs/development.md` (`dev-install`), `GLOSSARY.md` (Update, Bootstrap installer), the help text in `src/cli.js`, and `changelog.d/install-destination-selection.md` plus a new fragment. Distinguish current from historical behavior. The documentation Ticket re-runs `tds-factory run sweep` for `update`, `install.sh`, `install.ps1`, `dev-install`, `TDS_FACTORY_FORCE`, `reuse-selection` and `Bootstrap` at the end of Build.

## Testing decisions

- `test/update.test.js` with injected fetch, runner and terminal: cancel and no-terminal before the first fetch and with the runner never called; flags and prompt answers reach the `install` child as explicit flags; no second prompt; `--reuse-selection` with and without a saved selection; the existing checksum, retry and no-downgrade cases unchanged.
- `test/install-cli.test.js`: the serializer round trip for every destination kind.
- `test/install-sh.test.js`: run the real script as a process, with stub `node`, `npm` and `tds-factory` on PATH, once with stdin as the script piped (`sh < install.sh`) and a controlling terminal supplied by `script` where available, and without a terminal. Cover arguments, variables, conflicts, cancellation after the npm step and unchanged skills.
- `test/install-ps1.test.js` is not extended in this Run, because `install.ps1` is unchanged.
- `test/dev-install.test.js`: flags reach the stubbed CLI.
- Run `shellcheck scripts/*.sh`, PSScriptAnalyzer and `npm run check`.

## Out of scope

Adding `--project` to `update`; changing the checksum, retry or no-downgrade rules; installing Node; Windows PowerShell 5.1; a macOS adapter; changing how `dev-install.js` copies dev skills.

## Size estimate

Counted once per file, without lockfiles and fixtures. The user chose to keep this one Run despite the estimate; the total is above two thirds of the Factory limit (10 files, 27 KB) and no split is proposed.

| Work                                                     | Files | Diff     |
| -------------------------------------------------------- | ----: | -------- |
| Define: this Spec and ADR 0039                           |     2 | 8 KB     |
| Ticket 1: resolve-then-pass seam in `install`            |     2 | 3-4 KB   |
| Ticket 2: `update` chooses before the upgrade            |     3 | 6-8 KB   |
| Ticket 3: `install.sh` options and real entry point test |     2 | 5-7 KB   |
| Ticket 4: `install.ps1` options and Windows console test |     2 | 5-7 KB   |
| Ticket 5: `dev-install.js` forwarding                    |     2 | 2-3 KB   |
| Ticket 6: documentation, glossary, help and changelog    |     7 | 5-7 KB   |
| Total after file overlap                                 | 16-18 | 34-44 KB |

The estimate is above two thirds of the limit and near the limit itself, so Build may reach the point where it waits for the user ([ADR 0035](../adr/0035-build-waits-on-the-user-when-a-run-outgrows-the-size-limit.md)).

## Further notes

The first update from a CLI without this change cannot choose before the upgrade. [Issue #568](https://github.com/TDSchreur/tds-factory/issues/568) is the parent of all Tickets.
