## Problem Statement

Installing the Factory is two commands, and updating it is the same two commands again. A user has to remember the long `npm install -g --allow-remote=root <url>` line, check Node by hand, and run `tds-factory install` afterwards or the Skills no longer match the CLI. Other tools offer one line (`curl ... | sh`, `irm ... | iex`). A separate PowerShell updater exists outside this repo; it works, but it is Windows only, cannot be tested by `npm test`, and a `.sh` twin would duplicate its logic.

## Solution

Add an Update command to the CLI and two Bootstrap installers attached to every Release.

- `tds-factory update` looks up the latest Release, installs it with npm when the installed version is older, and then refreshes the Skills and Stage agents with `tds-factory install --force`. `--no-force` keeps edited agent files.
- `install.sh` (macOS, Linux) and `install.ps1` (Windows) are thin: check Node 20 or newer and npm, run the existing `npm install -g` command on the latest Release URL, run `tds-factory install`, print next steps.
- `release.yml` attaches `tds-factory.tgz.sha256`, `install.sh` and `install.ps1` to the Release in the same call that creates it, and the existing install URL checks cover them.
- README and install guide start with the two one-liners and keep the manual commands.

## User Stories

1. As a new user on macOS or Linux, I want one `curl | sh` line that installs the Factory and its Skills, so that I do not copy a long npm command.
2. As a new user on Windows, I want one `irm | iex` line that does the same, so that I get the same result on every OS.
3. As a user, I want `tds-factory update` to move me to the latest Release and refresh my Skills, so that CLI and Skills never drift apart.
4. As a user who is already current, I want `update` to skip the npm install but still refresh the Skills, and to tell me which it did.
5. As a user on a build newer than the latest Release (a `dev-install`), I want `update` to say so and change nothing, so that it never downgrades me.
6. As a user who edited agent files, I want `update --no-force` to keep them, so that my model choices survive.
7. As a user, I want `update` to verify the download against the published checksum and stop on a mismatch, so that a corrupted download is not installed. An older Release without a checksum warns and continues.
8. As a user behind a rate-limited GitHub API, I want `update` to fall back to the `/releases/latest` redirect and retry transient failures, so that a busy network does not break the update.
9. As a user with Node missing or older than 20, I want the Bootstrap installer to say so and where to get Node, instead of failing inside npm.
10. As a Linux user whose npm cannot write its global folder, I want the Bootstrap installer to print the user-prefix and nvm fix, never a `sudo` suggestion.
11. As a user, I want to pass `TDS_FACTORY_FORCE=1` or `TDS_FACTORY_SKIP_SKILLS=1` to the Bootstrap installers, since `irm | iex` cannot take parameters, and the same variables on both.
12. As a maintainer, I want the Release to carry the Bootstrap installers and checksum from the moment it is Latest, so that the one-liners never return 404.
13. As a maintainer, I want shellcheck and PSScriptAnalyzer in CI and tests for `update` and `install.sh`, so that the scripts stay correct.
14. As a reader of the docs, I want the manual `npm install -g` commands kept next to the one-liners, so that I can read before running.

## Implementation Decisions

- **Update module.** A new `src/update.js` owns the whole flow, exposed through `tds-factory update [--no-force]`. Its HTTP fetch, command runner, temp folder and sleep are injected parameters, so tests drive it without network or real npm. Version lookup uses the GitHub API (with `GITHUB_TOKEN` when set), then falls back to the redirect of `/releases/latest`, with 3 attempts and exponential backoff. Versions compare as semver; a prerelease sorts below its release.
- **Install step.** The tgz is downloaded to a fresh temp folder that is removed afterwards, checked against `tds-factory.tgz.sha256` when the Release has one, and installed with `npm install -g <file>`. The new version is read back with `tds-factory --version` and must equal the Release.
- **Skills step.** `tds-factory install --force` is started as a child process after the npm step, so the newly installed code runs it, not the old process. It runs also when already current. `--no-force` runs it without `--force`. Using `--force` by default is the user's decision; it replaces edited agent files with the defaults, and `update` says so as it runs.
- **Never downgrade.** Installed newer than latest: print that and make no change, not even the Skills step.
- **Bootstrap installers.** `scripts/install.sh` and `scripts/install.ps1`, not part of the npm package (`files` is unchanged). Both are idempotent. Environment variables: `TDS_FACTORY_FORCE=1` adds `--force` to `tds-factory install`; `TDS_FACTORY_SKIP_SKILLS=1` skips it. Neither installs Node. `install.sh` recognises EACCES in npm's output and prints the `--prefix ~/.local` and nvm advice. `install.ps1` runs on Windows PowerShell 5.1 and `pwsh`. The installers do not verify the checksum; `update` does.
- **Release workflow.** `gh release create` attaches `tds-factory.tgz`, `tds-factory.tgz.sha256`, `install.sh` and `install.ps1`. The closing check downloads all four from `releases/latest/download/` and compares them with the built files; `latest-release.yml` checks that all four URLs resolve. `docs/releasing.md` lists the four assets.
- **CI.** `ci.yml` gets a pinned shellcheck job (download verified by checksum, like actionlint), a pinned PSScriptAnalyzer job, and a Windows smoke test running `install.ps1` against stub `node` and `npm`.
- **Docs.** `README.md` Setup and `docs/install.md` part 2 open with the two one-liners; the manual commands stay as the inspectable alternative; update sections name `tds-factory update`; Troubleshooting covers a failing one-liner. `GLOSSARY.md` gains Update and Bootstrap installer; ADR 0009 records why bootstrap installers are acceptable after ADR 0005.
- The reference PowerShell updater is used for behaviour only; nothing is copied from it.

## Testing Decisions

- **Seams:** the `update` function with injected fetch, runner and temp folder; the `tds-factory update` command output and exit code; `install.sh` run as a process with stub `node` and `npm` first on PATH. A good test asserts what the user sees and which commands ran, not internal helpers.
- `update`: older installed version installs then runs `install --force`; current skips npm but runs install; newer than latest changes nothing; `--no-force` omits `--force`; API failure falls back to the redirect; transient failure retries then succeeds; permanent failure reports the error and exits 1; checksum match installs, mismatch aborts before npm runs, missing checksum warns and installs; wrong version after install fails.
- `install.sh`: happy path runs the npm install then `tds-factory install`; Node too old and npm missing stop with a message before npm runs; EACCES prints the prefix advice and no `sudo`; the two environment variables work. Skipped when `sh` is unavailable.
- `test/readme-install.test.js` is updated for the new README order, and a test checks that `release.yml` attaches the four assets and that the README, install guide and Release workflow name the same URLs.

## Out of Scope

- Installing Node, or switching npm's prefix automatically.
- Verifying the checksum inside the bootstrap installers.
- Detecting a `dev-install` beyond the never-downgrade rule.
- Signing Releases or artifact attestations.
- Changing how Releases are triggered or versioned.

## Further Notes

Analysis and decisions came from comparing the external `Update-TdsFactory.ps1` with this repo's install flow. That script defaults to `--force`; here `update` does too, by the user's choice, while the bootstrap installers keep `--force` opt-in through `TDS_FACTORY_FORCE=1` because a first install has nothing to replace.
