# Switches this machine to the TDS Factory in this checkout, including uncommitted changes.
# Removes the globally installed official Release first, then installs a pack of this checkout and its skills.
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tmp | Out-Null

function Say($message) { Write-Output "==> $message" }

# A failing native command does not stop a PowerShell script by itself.
function Invoke-Checked {
    # npm.ps1 re-parses its own call statement and breaks on an indirect call, so run the application (npm.cmd on Windows).
    $exe = (Get-Command $args[0] -CommandType Application | Select-Object -First 1).Source
    & $exe @($args | Select-Object -Skip 1)
    if ($LASTEXITCODE -ne 0) { throw "$($args -join ' ') failed with exit code $LASTEXITCODE" }
}

try {
    Say 'Packing this checkout'
    Push-Location $repo
    try { $tgz = (npm pack --silent --pack-destination $tmp | Select-Object -Last 1).Trim() }
    finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'npm pack failed' }

    Say 'Removing the installed tds-factory'
    Invoke-Checked npm uninstall -g tds-factory

    Say 'Installing the repo version'
    Invoke-Checked npm install -g (Join-Path $tmp $tgz)

    Say 'Installing skills and agents (--force: replaces the official version of the skills)'
    Invoke-Checked tds-factory install --force

    Say "Now using the repo version: tds-factory $(tds-factory --version)"
}
finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
