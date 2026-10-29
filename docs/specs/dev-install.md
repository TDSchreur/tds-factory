# Dev install of the latest default branch

## Problem

`setup.sh` and `setup.ps1` are obsolete: they install the working tree of a checkout. Factory developers install the npm Release, which lags behind `master`. After a PR is merged they want the CLI and skills as they are on `master` now.

## Solution

A cross-platform `scripts/dev-install.js` (Node, no dependencies). It fetches `origin`, resolves the default branch of `origin`, packs that commit with `git archive`, and runs `npm install -g` on the archive. The local checkout, its branch and uncommitted changes are never touched. `setup.sh`, `setup.ps1` and their tests are removed.

## User stories

1. As a Factory developer, I want one command that installs the latest default branch of origin, so that I use a merged PR right away.
2. As a developer, I want it to fetch first, so that I do not have to pull.
3. As a developer, I want my working tree left alone.
4. As a developer, I want it to stop with a clear error when origin cannot be fetched.

## Decisions

- Run with `node scripts/dev-install.js`; it prints the commit installed and says to run `tds-factory install`.
- The default branch comes from `git symbolic-ref refs/remotes/origin/HEAD` after `git remote set-head origin --auto`.
- Installed version is the `package.json` version of that commit (no Release version).
- README "Working from a checkout" and ADR 0005 stop mentioning the setup scripts.

## Testing

`test/dev-install.test.js` with `node:test`: a real bare origin, a clone, and a stub `npm` on PATH (POSIX only). Cases: installs the tip of origin's default branch including a commit not yet pulled locally; leaves the local checkout untouched; fails when fetch fails.
