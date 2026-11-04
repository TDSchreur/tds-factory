// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
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

const AGENT_RECORD = '.tds-factory-agents.json';

/** @param {string} file @returns {Record<string, string> | undefined} */
function agentRecord(file) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (!stat.isFile()) throw new Error(`cleanup refuses non-file agent record: ${printable(file)}`);
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('expected an object');
    for (const [name, hash] of Object.entries(record)) {
      if (
        !name ||
        name === '.' ||
        name === '..' ||
        name === AGENT_RECORD ||
        Buffer.byteLength(name) > 255 ||
        /[<>:"/\\|?*\x00-\x1f\x7f]/.test(name) ||
        /[. ]$/.test(name) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ||
        typeof hash !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(hash)
      )
        throw new Error('invalid entry');
    }
    return record;
  } catch (cause) {
    throw new Error(`invalid cleanup agent record: ${printable(file)}`, { cause });
  }
}

// Snapshots include entries the historical install hash omits, such as empty directories and links.
/** @param {string} file */
function snapshot(file) {
  const stat = fs.lstatSync(file);
  const hash = createHash('sha256');
  /** @type {string[]} */
  const pending = [file];
  let emptyDirectory = false;
  let hasLinks = false;
  while (pending.length) {
    const current = /** @type {string} */ (pending.pop());
    const entry = fs.lstatSync(current);
    hash.update(`${path.relative(file, current)}\0`);
    if (entry.isSymbolicLink()) {
      hasLinks = true;
      hash.update(`link:${fs.readlinkSync(current)}\0`);
    } else if (entry.isFile()) hash.update('file:').update(fs.readFileSync(current)).update('\0');
    else if (entry.isDirectory()) {
      const children = fs.readdirSync(current).sort();
      emptyDirectory ||= children.length === 0;
      hash.update('directory\0');
      pending.push(...children.map((name) => path.join(current, name)));
    } else throw new Error(`cleanup refuses special file: ${printable(current)}`);
  }
  return { identity: `${stat.dev}:${stat.ino}`, content: hash.digest('hex'), emptyDirectory, hasLinks };
}

// Callers must establish that another security principal cannot replace these paths.
// Rechecks detect ordinary edits; they do not provide atomic isolation from a concurrent writer.
/** @param {{ skillsDir: string, agentsDir: string, backupRoot: string, trustedPaths?: boolean, dryRun?: boolean, log?: (message: string) => void, guard?: { check: (file: string) => void } }} options */
export function cleanupDestination({
  skillsDir,
  agentsDir,
  backupRoot,
  trustedPaths = false,
  dryRun = false,
  log = console.log,
  guard,
}) {
  if (trustedPaths !== true) throw new Error('cleanup requires trusted filesystem paths established by the caller');
  skillsDir = directory(skillsDir);
  agentsDir = directory(agentsDir);
  backupRoot = directory(backupRoot);
  const paths = [skillsDir, agentsDir, backupRoot];
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++)
      if (overlaps(paths[i], paths[j]) || overlaps(paths[j], paths[i]))
        throw new Error('cleanup destination and backup paths must not overlap');
  const recordFile = path.join(agentsDir, AGENT_RECORD);
  const record = agentRecord(recordFile);
  /** @type {{ file: string, backup: boolean, relative: string }[]} */
  const owned = [];
  for (const entry of fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir, { withFileTypes: true }) : []) {
    const dir = path.join(skillsDir, entry.name);
    const marker = path.join(dir, MARKER);
    if (!entry.isDirectory()) continue;
    const evidence = fs.lstatSync(marker, { throwIfNoEntry: false });
    if (evidence?.isSymbolicLink()) throw new Error(`cleanup refuses symbolic link: ${printable(marker)}`);
    if (evidence?.isFile()) {
      const state = snapshot(dir);
      const backup = state.emptyDirectory || state.hasLinks || fs.readFileSync(marker, 'utf8') !== hashLine(dir);
      owned.push({ file: dir, backup, relative: path.join('skills', entry.name) });
    }
  }
  let keepRecord = false;
  for (const [name, hash] of Object.entries(record ?? {})) {
    const file = path.join(agentsDir, name);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat) continue;
    if (!stat.isFile()) {
      keepRecord = true;
      continue;
    }
    const backup = createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== hash.toLowerCase();
    owned.push({ file, backup, relative: path.join('agents', name) });
  }
  const backupRecord = owned.some((entry) => entry.backup && path.dirname(entry.file) === agentsDir);
  if (record && !keepRecord)
    owned.push({ file: recordFile, backup: backupRecord, relative: path.join('agents', AGENT_RECORD) });
  const original = new Map(owned.map((entry) => [entry.file, snapshot(entry.file)]));
  /** @param {string} file */
  const unchanged = (file) => {
    directory(skillsDir);
    directory(agentsDir);
    directory(backupRoot);
    directory(path.dirname(file));
    const before = original.get(file);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink()) throw new Error(`cleanup path changed: ${printable(file)}`);
    const now = snapshot(file);
    if (before?.identity !== now.identity || before.content !== now.content)
      throw new Error(`cleanup content changed: ${printable(file)}`);
  };
  const planned = owned.map((entry) => entry.file);
  const preserved = [skillsDir, agentsDir].flatMap((dir) =>
    (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
      .map((name) => path.join(dir, name))
      .filter((file) => !planned.includes(file)),
  );
  /** @type {string | undefined} */
  let backupDir;
  if (!dryRun && owned.some((item) => item.backup)) {
    fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
    backupDir = fs.mkdtempSync(path.join(backupRoot, 'cleanup-'));
    for (const item of owned.filter((entry) => entry.backup)) {
      guard?.check(item.file);
      unchanged(item.file);
      const dest = path.join(backupDir, item.relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(item.file, dest, { recursive: true, dereference: false, verbatimSymlinks: true });
    }
    if (backupRecord && keepRecord) fs.copyFileSync(recordFile, path.join(backupDir, 'agents', AGENT_RECORD));
    log(`backed up edited Factory files -> ${printable(backupDir)}`);
  }
  for (const item of owned.filter((entry) => entry.backup)) if (dryRun) log(`would back up ${printable(item.file)}`);
  for (const item of owned) unchanged(item.file);
  for (const item of owned) {
    guard?.check(item.file);
    unchanged(item.file);
    if (!dryRun) fs.rmSync(item.file, { recursive: true });
    log(`${dryRun ? 'would remove' : 'removed'} ${printable(item.file)}`);
  }
  return { backupDir, planned, preserved, removed: dryRun ? [] : planned };
}
