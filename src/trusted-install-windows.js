// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { printable } from './printable.js';

// This fixed script consumes paths as JSON on stdin; no path is interpolated into PowerShell code.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
$paths = @(ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd()))
if ($paths.Count -eq 0) { throw 'No paths' }
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
# Windows protects system volume roots with the Windows Modules Installer service owner.
$trusted = @($user, 'S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
$unsafe = [int64]0x500D0156
foreach ($entry in $paths) {
  $p = $entry.path
  $root = [System.IO.Path]::GetPathRoot($p)
  $drive = [System.IO.DriveInfo]::new($root)
  if ($drive.DriveType -ne [System.IO.DriveType]::Fixed -or $drive.DriveFormat -ne 'NTFS') { throw 'Unsupported volume' }
  $item = Get-Item -LiteralPath $p -Force
  if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Reparse point' }
  $acl = Get-Acl -LiteralPath $p
  $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  if ($owner -notin $trusted) { throw "Untrusted owner $owner at $p" }
  $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.Sddl)
  if ($null -eq $raw.DiscretionaryAcl) { throw 'Missing DACL' }
  foreach ($ace in $raw.DiscretionaryAcl) {
    if ($ace -isnot [System.Security.AccessControl.CommonAce]) { throw 'Unsupported ACE' }
    if ($ace.AceQualifier -notin @([System.Security.AccessControl.AceQualifier]::AccessAllowed, [System.Security.AccessControl.AceQualifier]::AccessDenied)) { throw 'Unsupported ACE qualifier' }
    if ($ace.AceQualifier -eq [System.Security.AccessControl.AceQualifier]::AccessAllowed) {
      $sid = $ace.SecurityIdentifier.Value
      # Inherit-only ACEs do not grant access to this object. Check them on
      # directories where this operation may create children, not ancestors
      # whose existing child descriptors are checked independently.
      if (($ace.AceFlags -band [System.Security.AccessControl.AceFlags]::InheritOnly) -and -not $entry.checkInheritance) { continue }
      $creator = $sid -eq 'S-1-3-0' -and ($ace.AceFlags -band [System.Security.AccessControl.AceFlags]::InheritOnly)
      $mask = [int64]$ace.AccessMask -band [int64]0xffffffff
      $relevant = if ($entry.checkInheritance) { $unsafe } else { [int64]0x500D0040 }
      if (-not $creator -and $sid -notin $trusted -and ($mask -band $relevant)) { throw "Untrusted grant at $p for $sid (mask $mask; flags $($ace.AceFlags))" }
    }
  }
}
[Console]::Out.Write('verified')
} catch [System.Exception] {
  [Console]::Error.Write($_.Exception.Message)
  exit 1
}
`;

/** @param {string[]} paths @param {boolean} recursive */
export function verifyWindowsInstallPaths(paths, recursive) {
  /** @type {Map<string, boolean>} */
  const found = new Map();
  const pending = [...paths];
  while (pending.length) {
    const requested = /** @type {string} */ (pending.pop());
    if (!path.isAbsolute(requested)) throw new Error('install path must be absolute');
    let current = path.resolve(requested);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    let nearest = true;
    while (true) {
      if (fs.lstatSync(current, { throwIfNoEntry: false })) {
        found.set(current, Boolean(found.get(current)) || nearest);
        nearest = false;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (recursive && stat?.isDirectory() && !stat.isSymbolicLink())
      pending.push(...fs.readdirSync(requested).map((name) => path.join(requested, name)));
  }
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  const result = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    input: JSON.stringify([...found].map(([file, checkInheritance]) => ({ path: file, checkInheritance }))),
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 1024 * 1024,
    cwd: os.homedir(),
    env: { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' },
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || result.stdout !== 'verified') {
    const detail = result.stderr?.trim() || result.error?.message || 'unexpected verification output';
    throw new Error(`cannot verify Windows install paths: ${printable(detail)}`);
  }
}
