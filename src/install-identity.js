// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { printable } from './printable.js';

/** The identity of an existing object without following links: device and inode (on Windows the volume serial and file index).
 * @param {string} file @returns {string | undefined} */
export function identityOf(file) {
  const stat = fs.lstatSync(file, { bigint: true, throwIfNoEntry: false });
  if (!stat) return undefined;
  return `${stat.isSymbolicLink() ? 'link:' : ''}${stat.dev}:${stat.ino}`;
}

/** @typedef {{ check: (file: string) => void, adopt: (file: string) => void, merge: (other: { known: Map<string, string | undefined> }) => void, known: Map<string, string | undefined> }} IdentityGuard */

/** @param {string} a @param {string} b */
const within = (a, b) => {
  const relative = path.relative(a, b);
  return !relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};

/**
 * The identities of the paths a verification inspected. `check` runs immediately before a mutation and refuses when a
 * recorded path or one of its recorded ancestors is another object now, or when a link appeared where nothing existed.
 * `adopt` records what the installer itself created or replaced. It detects a swap; it does not make the mutation atomic.
 * @param {Map<string, string | undefined>} [known] Absent paths map to undefined.
 * @returns {IdentityGuard}
 */
export function identityGuard(known = new Map()) {
  /** @param {string} file */
  const check = (file) => {
    const target = path.resolve(file);
    for (const [recorded, identity] of known) {
      if (!within(recorded, target)) continue;
      const now = identityOf(recorded);
      if (identity === undefined ? now?.startsWith('link:') : now !== identity)
        throw new Error(`install path changed after it was verified: ${printable(recorded)}`);
    }
  };
  /** @param {string} file */
  const adopt = (file) => {
    const target = path.resolve(file);
    for (const recorded of [...known.keys()])
      if (recorded !== target && within(target, recorded)) known.delete(recorded);
    let current = target;
    while (true) {
      const identity = identityOf(current);
      if (identity === undefined) break;
      if (known.get(current) !== undefined && current !== target) break;
      known.set(current, identity);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  };
  /** @param {{ known: Map<string, string | undefined> }} other */
  const merge = (other) => {
    for (const [file, identity] of other.known) if (!known.has(file)) known.set(file, identity);
  };
  return { check, adopt, merge, known };
}
