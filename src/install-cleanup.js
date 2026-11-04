// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { MARKER } from './paths.js';
import { hashLine } from './tree-hash.js';
import { printable } from './printable.js';

// Check each existing component, including a dangling link. Missing suffixes are allowed.
/** @param {string} input */
function directory(input) {
  const dir = path.resolve(input);
  let current = dir;
  while (true) {
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error(`cleanup refuses symbolic link: ${printable(current)}`);
    if (stat && !stat.isDirectory()) throw new Error(`cleanup needs a directory: ${printable(current)}`);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dir;
}

/** @param {string} a @param {string} b */
function overlaps(a, b) {
  const relative = path.relative(a, b);
  return !relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

/** @param {{ skillsDir: string, agentsDir: string, backupRoot: string, dryRun?: boolean, log?: (message: string) => void }} options */
export function cleanupDestination({ skillsDir, agentsDir, backupRoot, dryRun = false, log = console.log }) {
  skillsDir = directory(skillsDir);
  agentsDir = directory(agentsDir);
  backupRoot = directory(backupRoot);
  const paths = [skillsDir, agentsDir, backupRoot];
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++)
      if (overlaps(paths[i], paths[j]) || overlaps(paths[j], paths[i]))
        throw new Error('cleanup destination and backup paths must not overlap');
  /** @type {{ file: string, backup: boolean, relative: string }[]} */
  const owned = [];
  for (const entry of fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir, { withFileTypes: true }) : []) {
    const dir = path.join(skillsDir, entry.name);
    const marker = path.join(dir, MARKER);
    if (!entry.isDirectory()) continue;
    const evidence = fs.lstatSync(marker, { throwIfNoEntry: false });
    if (evidence?.isSymbolicLink()) throw new Error(`cleanup refuses symbolic link: ${printable(marker)}`);
    if (evidence?.isFile()) {
      const hasLinks = fs.readdirSync(dir, { recursive: true, withFileTypes: true }).some((e) => e.isSymbolicLink());
      const backup = hasLinks || fs.readFileSync(marker, 'utf8') !== hashLine(dir);
      owned.push({ file: dir, backup, relative: path.join('skills', entry.name) });
    }
  }
  /** @type {string | undefined} */
  let backupDir;
  if (!dryRun && owned.some((item) => item.backup)) {
    fs.mkdirSync(backupRoot, { recursive: true });
    backupDir = fs.mkdtempSync(path.join(backupRoot, 'cleanup-'));
    for (const item of owned.filter((item) => item.backup)) {
      const dest = path.join(backupDir, item.relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(item.file, dest, { recursive: true, dereference: false, verbatimSymlinks: true });
    }
    log(`backed up edited Factory files -> ${printable(backupDir)}`);
  }
  for (const item of owned.filter((item) => item.backup)) if (dryRun) log(`would back up ${printable(item.file)}`);
  for (const item of owned) {
    if (!dryRun) fs.rmSync(item.file, { recursive: true });
    log(`${dryRun ? 'would remove' : 'removed'} ${printable(item.file)}`);
  }
  return { backupDir, removed: dryRun ? [] : owned.map((item) => item.file) };
}
