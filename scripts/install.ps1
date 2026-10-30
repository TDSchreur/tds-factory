# Installs the latest TDS Factory Release and its skills. Safe to run again to update.
#   powershell -c "irm https://github.com/TDSchreur/tds-factory/releases/latest/download/install.ps1 | iex"
# Options, as environment variables (irm | iex cannot take parameters):
#   TDS_FACTORY_FORCE=1        run `tds-factory install --force` (replaces edited agent files and skills, and same-named skills that tds-factory did not install)
#   TDS_FACTORY_SKIP_SKILLS=1  only install the CLI, do not run `tds-factory install`
# Written for Windows PowerShell 5.1 as well as PowerShell 7: no ??, ?:, && or ||.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# npm and tds-factory come as .ps1 and .cmd shims on Windows, and PowerShell picks the .ps1 ones, which the default
# execution policy (Restricted) blocks. Ask for the .cmd shim by name when there is one.
function Get-Shim([string]$Name) {
    if (Get-Command "$Name.cmd" -ErrorAction SilentlyContinue) { return "$Name.cmd" }
    return $Name
}

function Install-TdsFactory {
    # cmd.exe looks in the current folder before PATH, and the npm-made tds-factory.cmd runs `node` that way. The person who
    # pastes this line may be standing in an untrusted checkout, so work from the home folder with that lookup switched off,
    # and put both back afterwards: under `irm | iex` this is the person's own session.
    $previousSwitch = $env:NoDefaultCurrentDirectoryInExePath
    Push-Location -LiteralPath $HOME
    try {
        $env:NoDefaultCurrentDirectoryInExePath = '1'
        $url = 'https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz'
        $minNode = 20

        foreach ($tool in 'node', 'npm') {
            if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
                throw "$tool not found. Install Node $minNode or newer from https://nodejs.org and run this again."
            }
        }
        $nodeVersion = ("$(& node --version)").Trim()
        if ($nodeVersion -notmatch '^v?(\d+)\.') { throw "could not read the Node version ('$nodeVersion')" }
        if ([int]$Matches[1] -lt $minNode) {
            throw "Node $nodeVersion found, need $minNode or newer. Upgrade from https://nodejs.org and run this again."
        }

        Write-Host '==> Installing tds-factory with npm'
        $npm = Get-Shim 'npm'
        & $npm install -g --allow-remote=root $url
        if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE); see the output above." }
        # Only now does tds-factory exist, so only now can its shim be chosen.
        $tdsFactory = Get-Shim 'tds-factory'
        if (-not (Get-Command $tdsFactory -ErrorAction SilentlyContinue)) {
            throw "installed, but tds-factory is not on your PATH. Run 'npm prefix -g', add that folder to PATH, open a new terminal and run 'tds-factory install'."
        }

        if ($env:TDS_FACTORY_SKIP_SKILLS -eq '1') {
            Write-Host '==> Skipping skills install (TDS_FACTORY_SKIP_SKILLS=1)'
        }
        else {
            $arguments = @('install')
            if ($env:TDS_FACTORY_FORCE -eq '1') {
                $arguments += '--force'
                Write-Host '==> Installing skills and agents (--force: edited agent files and skills, and same-named skills that tds-factory did not install, are replaced)'
            }
            else { Write-Host '==> Installing skills and agents' }
            & $tdsFactory @arguments
            if ($LASTEXITCODE -ne 0) { throw "tds-factory $($arguments -join ' ') failed (exit $LASTEXITCODE)." }
        }

        Write-Host "==> Done: tds-factory $(("$(& $tdsFactory --version)").Trim())"
        Write-Host "Next: run 'tds-factory doctor' in a project, then read https://github.com/TDSchreur/tds-factory/blob/main/docs/usage.md"
    }
    finally {
        Pop-Location
        if ($null -eq $previousSwitch) { Remove-Item Env:NoDefaultCurrentDirectoryInExePath -ErrorAction SilentlyContinue }
        else { $env:NoDefaultCurrentDirectoryInExePath = $previousSwitch }
    }
}

# Under `irm | iex` there is no script file, and `exit` would close the user's terminal, so only exit when run as a file.
try { Install-TdsFactory }
catch {
    Write-Host "error: $($_.Exception.Message)" -ForegroundColor Red
    if ($PSCommandPath) { exit 1 }
}
