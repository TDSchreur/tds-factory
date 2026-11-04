// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { printable } from './printable.js';
import { verifyWindowsInstallPaths } from './trusted-install-windows.js';

// These Linux filesystems implement the POSIX ACL mask represented by group mode bits.
const LINUX_FILESYSTEMS = new Set([0xef53, 0x9123683e]);

/** Run a fixed macOS system command without a shell; reject incomplete or ambiguous output.
 * @param {string} command @param {string[]} args @param {string | undefined} [input] */
function macCommand(command, args, input) {
  const result = spawnSync(command, args, {
    input,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C' },
    cwd: '/',
  });
  if (result.error || result.status !== 0 || result.stderr) {
    const detail = result.stderr?.trim() || result.error?.message || `exit status ${result.status}`;
    throw new Error(`cannot verify install path using ${command}: ${printable(detail)}`);
  }
  return result.stdout;
}

/** @param {string} file @param {number} device @param {Set<number>} checkedVolumes */
function verifyMac(file, device, checkedVolumes) {
  if (/[\x00-\x1f\x7f]/.test(file)) throw new Error('unsupported control character in install path');
  const lines = macCommand('/bin/ls', ['-lde', file]).replace(/\n$/, '').split('\n');
  if (lines.length !== 1 || !/^[bcdlps-][rwxstST-]{9}[ @]\s/.test(lines[0]))
    throw new Error(`unverified macOS ACL: ${printable(file)}`);
  if (checkedVolumes.has(device)) return;
  // diskutil accepts a device or mount point, not an arbitrary file below it.
  const rows = macCommand('/bin/df', ['-P', file]).trimEnd().split('\n');
  const source = rows.length === 2 ? rows[1].trimStart().split(/\s+/, 1)[0] : '';
  if (!/^\/dev\/disk\d+(?:s\d+)*$/.test(source)) throw new Error(`cannot identify macOS volume: ${printable(file)}`);
  const plist = macCommand('/usr/sbin/diskutil', ['info', '-plist', source]);
  const json = macCommand('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], plist);
  let info;
  try {
    info = JSON.parse(json);
  } catch {
    // The parser's details do not establish which volume was inspected.
    throw new Error(`cannot inspect macOS volume: ${printable(file)}`);
  }
  if (
    !info ||
    info.Internal !== true ||
    info.GlobalPermissionsEnabled !== true ||
    typeof info.FilesystemType !== 'string' ||
    !['apfs', 'hfs'].includes(info.FilesystemType.toLowerCase())
  )
    throw new Error(`unsupported or unverified macOS volume: ${printable(file)}`);
  checkedVolumes.add(device);
}

/**
 * Verify the existing paths and their ancestors before trusting a local install operation.
 * @param {string[]} paths
 * @param {{recursive?: boolean}} [options]
 */
export function verifyInstallPaths(paths, { recursive = false } = {}) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('install paths are required');
  if (process.platform === 'win32') return verifyWindowsInstallPaths(paths, recursive);
  if (process.platform !== 'linux' && process.platform !== 'darwin')
    throw new Error('trusted install path verification is unavailable on this platform');
  if (typeof process.getuid !== 'function') throw new Error('cannot determine the current user');
  const uid = process.getuid();
  const pending = [...paths];
  const visited = new Set();
  /** @type {Set<number>} */
  const checkedVolumes = new Set();
  while (pending.length) {
    const item = /** @type {string} */ (pending.pop());
    if (!path.isAbsolute(item)) throw new Error('install path must be absolute');
    const requested = path.resolve(item);
    if (visited.has(requested)) continue;
    visited.add(requested);
    const requestedStat = fs.lstatSync(requested, { throwIfNoEntry: false });
    let current = requested;
    while (true) {
      const stat = fs.lstatSync(current, { throwIfNoEntry: false });
      if (stat) {
        if (stat.isSymbolicLink()) throw new Error(`untrusted symbolic link: ${printable(current)}`);
        if (!stat.isFile() && !stat.isDirectory()) throw new Error(`unsupported install path: ${printable(current)}`);
        if (stat.uid !== uid && stat.uid !== 0) throw new Error(`untrusted path owner: ${printable(current)}`);
        if (stat.mode & 0o1000) throw new Error(`shared install path is unsupported: ${printable(current)}`);
        if (stat.mode & 0o022) throw new Error(`install path is writable by others: ${printable(current)}`);
        if (process.platform === 'linux' && !LINUX_FILESYSTEMS.has(fs.statfsSync(current).type))
          throw new Error(`unsupported filesystem: ${printable(current)}`);
        if (process.platform === 'darwin') verifyMac(current, stat.dev, checkedVolumes);
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (recursive && requestedStat?.isDirectory())
      pending.push(...fs.readdirSync(requested).map((name) => path.join(requested, name)));
  }
}
