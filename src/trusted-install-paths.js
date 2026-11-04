// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { printable } from './printable.js';
import { identityGuard, identityOf } from './install-identity.js';
import { verifyWindowsInstallPaths } from './trusted-install-windows.js';

// These Linux filesystems implement the POSIX ACL mask represented by group mode bits.
const LINUX_FILESYSTEMS = new Set([0xef53, 0x9123683e]);

/** Refuse a platform whose filesystem trust cannot be established, before anything else happens. */
export function assertSupportedPlatform() {
  if (process.platform !== 'linux' && process.platform !== 'win32')
    throw new Error(
      `installing is supported on Linux and Windows only; ${process.platform} is unsupported and nothing was changed`,
    );
}

/**
 * Verify the existing paths and their ancestors before trusting a local install operation.
 * @param {string[]} paths
 * @param {{recursive?: boolean}} [options]
 * @returns {ReturnType<typeof identityGuard>} The identities seen, to recheck immediately before each mutation.
 */
export function verifyInstallPaths(paths, { recursive = false } = {}) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('install paths are required');
  if (process.platform === 'win32') return identityGuard(verifyWindowsInstallPaths(paths, recursive));
  assertSupportedPlatform();
  if (typeof process.getuid !== 'function') throw new Error('cannot determine the current user');
  const uid = process.getuid();
  /** @type {Map<string, string | undefined>} */
  const known = new Map();
  const pending = [...paths];
  const visited = new Set();
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
      known.set(current, stat ? identityOf(current) : undefined);
      if (stat) {
        if (stat.isSymbolicLink()) throw new Error(`untrusted symbolic link: ${printable(current)}`);
        if (!stat.isFile() && !stat.isDirectory()) throw new Error(`unsupported install path: ${printable(current)}`);
        if (stat.uid !== uid && stat.uid !== 0) throw new Error(`untrusted path owner: ${printable(current)}`);
        if (stat.mode & 0o1000) throw new Error(`shared install path is unsupported: ${printable(current)}`);
        if (stat.mode & 0o022) throw new Error(`install path is writable by others: ${printable(current)}`);
        if (!LINUX_FILESYSTEMS.has(fs.statfsSync(current).type))
          throw new Error(`unsupported filesystem: ${printable(current)}`);
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (recursive && requestedStat?.isDirectory())
      pending.push(...fs.readdirSync(requested).map((name) => path.join(requested, name)));
  }
  return identityGuard(known);
}
