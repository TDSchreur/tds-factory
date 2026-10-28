# Clone setup script

## Problem Statement

After cloning this repo, `tds-factory` is not on PATH. The user must know to run `npm install -g .`, and to init the vendor submodules and run `tds-factory install` afterwards. Nothing in the repo does this for them.

## Solution

A `setup.sh` at the repo root that registers the CLI on PATH and then tells the user to run `tds-factory install`.

## User Stories

1. As a developer who just cloned the repo, I want one script that makes `tds-factory` available on PATH, so that I don't need to know the npm incantation.
2. As a developer, I want the script to work no matter which directory I start it from, so that I can run it by path.
3. As a developer, I want the script to stop with a clear message when Node 20+ or npm is missing, so that I know what to install.
4. As a developer, I want the script to tell me to run `tds-factory install` when it is done, so that the skills get installed too.
5. As a developer, I want the script to warn me when `tds-factory` is still not found on PATH after installing, so that I can fix my PATH.

## Implementation Decisions

- `setup.sh` is a POSIX `sh` script with the executable bit set, at the repo root. No new dependencies.
- It changes into its own directory, checks for `node` (major version 20 or newer) and `npm`, runs `npm install -g .`, then checks `command -v tds-factory`.
- It suggests `tds-factory install` but does not run it: installing into the user's agent directories is the user's decision.
- It does not touch submodules: `skills/` holds committed copies, so `install` works without `vendor/`.
- The README Setup section points at the script.

## Testing Decisions

Test through the script's behavior with `node:test` in `test/setup.test.js`: with a fake `PATH` lacking `node`, it exits non-zero with a message; with fake `node` and `npm` stubs it calls `npm install -g .` from the repo root and prints the `tds-factory install` suggestion; it warns when `tds-factory` is not on PATH.

## Out of Scope

- Windows support, uninstalling, running `install` automatically, initialising submodules.
