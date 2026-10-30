# Drop Windows PowerShell 5.1 support in install.ps1

## Problem Statement

`install.ps1` is written and tested for Windows PowerShell 5.1 and PowerShell 7. The 5.1 CI step takes about 3.5 minutes against 14 seconds for PowerShell 7, and makes `install-windows` the slowest CI job by far. Supporting 5.1 also keeps the script free of modern syntax (`??`, `?:`, `&&`, `||`).

## Solution

`install.ps1` supports PowerShell 7 (`pwsh`) only. The documented one-liner becomes `pwsh -c "irm ... | iex"`. CI runs the script on PowerShell 7 only. The decision is recorded in ADR 0011.

## User Stories

1. As a maintainer, I want a faster CI, so that PRs are checked sooner.
2. As a Windows user, I want the install line to say which shell it needs, so that I know to install PowerShell 7 first.

## Implementation Decisions

- README, install guide, development guide and the installer header use `pwsh -c`.
- The 5.1 CI step, the `INSTALL_PS1_SHELL: powershell` setting and the 5.1 syntax-guard test are removed.
- The script keeps its logic; only the 5.1 constraint comment goes.
- ADR 0011 records the trade-off; ADR 0009 and `one-line-installers.md` point to it.

## Testing Decisions

- `test/readme-install.test.js` and `test/ci.test.js` assert the new line and the single PowerShell 7 CI step.
- `npm test` passes.
