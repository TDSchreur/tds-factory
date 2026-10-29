import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MARKER } from './paths.js';

// Hash of a folder's relative paths and file contents; the marker is left out because it stores the hash.
export function hashTree(dir) {
  const hash = crypto.createHash('sha256');
  const files = fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath ?? e.path, e.name)))
    .filter((f) => f !== MARKER)
    .sort();
  for (const f of files) hash.update(`${f.split(path.sep).join('/')}\0`).update(fs.readFileSync(path.join(dir, f))).update('\0');
  return hash.digest('hex');
}

export const hashLine = (dir) => `sha256:${hashTree(dir)}\n`;

// True when the folder's marker records a hash and the contents no longer match it.
// A marker without a hash comes from an older version and counts as unmodified.
export function modifiedLocally(dir) {
  const recorded = fs.readFileSync(path.join(dir, MARKER), 'utf8').match(/^sha256:([0-9a-f]{64})$/m)?.[1];
  return recorded !== undefined && recorded !== hashTree(dir);
}
