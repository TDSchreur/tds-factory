// @ts-check
import fs from 'node:fs';
import path from 'node:path';

// Fills a staging folder next to dest, then renames it into place, so a failure never leaves dest half-written.
/**
 * @param {string} dest
 * @param {(staging: string) => void} populate
 */
export function replaceDir(dest, populate) {
  const parent = path.dirname(dest);
  const base = path.basename(dest);
  const staging = path.join(parent, `.${base}.staging-${process.pid}`);
  const old = path.join(parent, `.${base}.old-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(old, { recursive: true, force: true });
  try {
    fs.mkdirSync(staging, { recursive: true });
    populate(staging);
    const hadOld = fs.lstatSync(dest, { throwIfNoEntry: false }) !== undefined;
    if (hadOld) fs.renameSync(dest, old);
    try {
      fs.renameSync(staging, dest);
    } catch (err) {
      if (hadOld) fs.renameSync(old, dest);
      throw err;
    }
    fs.rmSync(old, { recursive: true, force: true });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
