# PowerShell setup script

## Problem Statement

`setup.sh` registers the CLI on PATH after a clone, but some team members use Windows and have no POSIX `sh`. They have to work out the npm steps themselves.

## Solution

A `setup.ps1` at the repo root that does what `setup.sh` does, for PowerShell.

## User Stories

1. As a Windows developer who just cloned the repo, I want one script that makes `tds-factory` available on PATH, so that I don't need to know the npm incantation.
2. As a developer, I want the script to work no matter which directory I start it from.
3. As a developer, I want the script to stop with a clear message when Node 20+ or npm is missing.
4. As a developer, I want the script to tell me to run `tds-factory install` when it is done.
5. As a developer, I want a warning when `tds-factory` is still not on PATH after installing.
6. As a developer, I want the same fallback as `setup.sh` when npm's global prefix is not writable.

## Implementation Decisions

- `setup.ps1` runs on Windows PowerShell 5.1 and PowerShell 7+. No new dependencies.
- It mirrors `setup.sh`: change to its own directory, check `node` (major 20 or newer) and `npm`, run `npm install -g .`, check for `tds-factory`.
- Fallback when the global prefix is not writable: `npm install -g --prefix "$HOME/.local" .`. Unlike on Unix, npm puts the shims in the prefix root on Windows, so the PATH warning names `$prefix` on Windows and `$prefix/bin` elsewhere.
- Errors go to stderr and exit non-zero.
- The README Setup section mentions both scripts. This supersedes the "Windows support" exclusion in `clone-setup-script.md`.

## Testing Decisions

Test through behavior in `test/setup-ps1.test.js` with `node:test`, running `pwsh` with a PATH of stubs, as `setup.test.js` does for `setup.sh`. Skip when `pwsh` is not installed. Cases: stops on old Node, stops without npm, installs from repo root and suggests `tds-factory install`, warns when the CLI is not on PATH.

## Out of Scope

- cmd.exe/batch version, uninstalling, running `install` automatically.
