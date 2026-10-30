# install.ps1 supports PowerShell 7 only

ADR 0009 attaches `install.ps1` to every Release and CI ran it on both Windows PowerShell 5.1 and PowerShell 7, because the documented line was `powershell -c "irm ... | iex"` and Windows 10 and 11 ship only 5.1. The 5.1 step took about 3.5 minutes against 14 seconds on PowerShell 7, and made the Windows job the slowest in CI. We now support PowerShell 7 only: the line is `pwsh -c "irm ... | iex"` and CI runs `install.ps1` on PowerShell 7 alone.

A Windows user must install PowerShell 7 before the one-liner works, which is one more prerequisite next to Node. We accept that, since the person installing a Node CLI is a developer who can install it, and the manual `npm install -g` commands still work from any shell, including 5.1. We rejected keeping 5.1 with fewer tests because the script would still have to avoid PowerShell 7 syntax, and without a 5.1 run in CI that promise would not be checked. Someone who pastes the old `powershell -c` line on 5.1 may see the script fail on newer syntax or not; we do not promise either.

This replaces the Windows PowerShell 5.1 support described in [ADR 0009](0009-bootstrap-installers-are-release-assets.md) and in [the one-line installers Spec](../specs/one-line-installers.md). See [the Spec](../specs/drop-windows-powershell-5-1.md).
