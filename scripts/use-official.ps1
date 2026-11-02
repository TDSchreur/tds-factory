# Switches this machine to the official TDS Factory Release from GitHub.
# Removes the globally installed repo build first, then installs the latest Release and its skills.
$ErrorActionPreference = 'Stop'

$url = 'https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz'

function Say($message) { Write-Output "==> $message" }

# A failing native command does not stop a PowerShell script by itself.
function Invoke-Checked {
    & $args[0] $args[1..($args.Length - 1)]
    if ($LASTEXITCODE -ne 0) { throw "$($args -join ' ') failed with exit code $LASTEXITCODE" }
}

Say 'Removing the installed tds-factory'
Invoke-Checked npm uninstall -g tds-factory

Say 'Installing the official Release'
Invoke-Checked npm install -g --allow-remote=root $url

Say 'Installing skills and agents (--force: replaces the repo version of the skills)'
Invoke-Checked tds-factory install --force

Say "Now using the official Release: tds-factory $(tds-factory --version)"
