# Register the tds-factory CLI on PATH from this checkout.
$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot

function Fail($message) {
  [Console]::Error.WriteLine("error: $message")
  exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail 'Node 20 or newer and npm are required'
}

$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 20) {
  Fail "Node 20 or newer is required (found $major)"
}

$prefix = (npm prefix -g | Out-String).Trim()
# A prefix that does not exist yet (fresh Windows machine) is created by npm.
$writable = -not (Test-Path -LiteralPath $prefix)
if (-not $writable) { try {
  $probe = Join-Path $prefix ".tds-factory-write-test-$PID"
  New-Item -ItemType File -Path $probe -ErrorAction Stop | Out-Null
  $writable = $true
  Remove-Item -LiteralPath $probe -ErrorAction SilentlyContinue
} catch {} }

if ($writable) {
  npm install -g .
} else {
  $prefix = Join-Path $HOME '.local'
  Write-Host "npm's global prefix is not writable; installing to $prefix instead"
  npm install -g --prefix $prefix .
}
if ($LASTEXITCODE -ne 0) { Fail 'npm install failed' }

if (-not (Get-Command tds-factory -ErrorAction SilentlyContinue)) {
  # npm puts the shims in the prefix itself on Windows, in prefix/bin elsewhere.
  $bin = if ($IsWindows -or $env:OS -eq 'Windows_NT') { $prefix } else { Join-Path $prefix 'bin' }
  [Console]::Error.WriteLine("warning: tds-factory is installed but not on your PATH; add $bin to it")
}

Write-Host ''
Write-Host 'Done. Next, install the skills: tds-factory install'
