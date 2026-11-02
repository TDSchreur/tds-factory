import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
/** @import { Run } from './run-record.js' */
import { codeOf } from './narrow.js';
import { stages, stageIndex } from './flow.js';
import { validId, validate, write, withStageModel } from './run-record.js';
import { appendEvent, deriveEvents, readEvents } from './run-events.js';
import { withUsage } from './run-usage.js';

/**
 * @param {string} projectDir
 * @param {boolean} [create]
 */
export function runRoot(projectDir, create) {
  const project = fs.realpathSync(projectDir);
  const factory = path.join(project, '.factory');
  const root = path.join(factory, 'runs');
  if (create) {
    if (!fs.existsSync(factory)) fs.mkdirSync(factory);
    if (fs.realpathSync(factory) !== factory) throw new Error('Run storage must not be symlinked');
    if (!fs.existsSync(root)) fs.mkdirSync(root);
  }
  if (fs.realpathSync(factory) !== factory || fs.realpathSync(root) !== root)
    throw new Error('Run storage must not be symlinked');
  return root;
}

/** @param {string} root @param {string} id */
export const lockFile = (root, id) => path.join(root, `.lock-${createHash('sha256').update(id).digest('hex')}`);
/** @param {string} p */
export const pathExists = (p) => !!fs.lstatSync(p, { throwIfNoEntry: false });
/**
 * @param {string} lock
 * @returns {{ state: string, pid?: number, host?: string, started?: string }}
 */
export function lockOwner(lock) {
  try {
    if (fs.lstatSync(lock).isSymbolicLink()) return { state: 'unknown' };
    const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
    if (
      !Number.isSafeInteger(owner.pid) ||
      owner.pid < 1 ||
      typeof owner.host !== 'string' ||
      !owner.host ||
      typeof owner.started !== 'string' ||
      !Number.isFinite(Date.parse(owner.started))
    )
      return { state: 'unknown' };
    let state = 'unknown';
    if (owner.host === os.hostname()) {
      try {
        process.kill(owner.pid, 0);
        state = 'live';
      } catch (err) {
        if (codeOf(err) === 'ESRCH') state = 'dead';
      }
    }
    return { ...owner, state };
  } catch {
    return { state: 'unknown' };
  }
}
/**
 * @template T
 * @param {string} lock
 * @param {() => T} action
 * @returns {T}
 */
export function withLock(lock, action) {
  const fd = fs.openSync(lock, 'wx', 0o600);
  const identity = fs.fstatSync(fd);
  try {
    fs.writeFileSync(
      fd,
      JSON.stringify({ pid: process.pid, host: os.hostname(), started: new Date().toISOString() }) + '\n',
    );
    return action();
  } finally {
    fs.closeSync(fd);
    try {
      const current = fs.lstatSync(lock);
      if (current.dev === identity.dev && current.ino === identity.ino) fs.unlinkSync(lock);
    } catch (err) {
      if (codeOf(err) !== 'ENOENT') throw err;
    }
  }
}
/** @param {string} root @param {string} id */
export const repairLockFile = (root, id) => lockFile(root, id).replace(`${path.sep}.lock-`, `${path.sep}.repair-`);
/**
 * @template T
 * @param {string} root
 * @param {string} id
 * @param {() => T} action
 * @returns {T}
 */
export const withRunLock = (root, id, action) => withLock(lockFile(root, id), action);

// A Run's folder and record, refusing links anywhere on the way.
/**
 * @param {string} projectDir
 * @param {string} id
 * @returns {{ root: string, dir: string, record: Run }}
 */
export function readRun(projectDir, id) {
  if (!validId(id)) throw new Error('invalid Run id');
  const root = runRoot(projectDir, false);
  const dir = path.join(root, id);
  if (fs.realpathSync(dir) !== dir) throw new Error('Run folder must not be a symlink');
  const file = path.join(dir, 'run.json');
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Run record must not be a symlink');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Run record must be an object');
  return { root, dir, record };
}
// Reads a Run record under its lock, hands it to change, and writes back what change returns.
/**
 * @param {string} projectDir
 * @param {string} id
 * @param {(old: Run) => Run} change
 */
export function changeRun(projectDir, id, change) {
  if (!validId(id)) throw new Error('invalid Run id');
  return withRunLock(runRoot(projectDir, false), id, () => {
    const { dir, record } = readRun(projectDir, id);
    const changed = change(record);
    // Every Stage change passes here, whether it is a transition, a Rework or a Follow-up.
    const next = withUsage(
      {
        ...(changed.stage !== record.stage ? withStageModel(changed) : changed),
        last_seen: new Date().toISOString(),
      },
      record,
      dir,
    );
    write(dir, next);
    for (const event of deriveEvents(record, next)) appendEvent(dir, event);
  });
}

// Changes a running Run for a named operation, which takes only an optional activity line besides its own arguments.
/**
 * @param {string} projectDir
 * @param {string} id
 * @param {{ activity?: string }} data
 * @param {(old: Run) => { record: Run, activity: string }} move
 */
export function changeRunning(projectDir, id, data, move) {
  validate(data);
  if (Object.keys(data).some((key) => key !== 'activity')) throw new Error('this operation accepts only activity');
  changeRun(projectDir, id, (old) => {
    if (old.status !== 'running') throw new Error(`a ${old.status} Run cannot be changed this way, only a running one`);
    const { record, activity } = move(old);
    return { ...record, activity: data.activity ?? activity, updated: new Date().toISOString() };
  });
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Sort Stage summaries in Flow order, with numbered Check and Follow-up summaries sorted numerically.
/** @param {string} name */
function stageOrder(name) {
  const base = name.replace(/\.md$/, '');
  const m = /^(check|follow-up)-(\d+)$/.exec(base);
  const index = stageIndex(m ? m[1] : base);
  return [index < 0 ? stages.length : index, m ? Number(m[2]) : 0];
}
/** @param {string} a @param {string} b */
const byStage = (a, b) => {
  const [x, y] = [stageOrder(a), stageOrder(b)];
  return x[0] - y[0] || x[1] - y[1] || a.localeCompare(b);
};

// Names of the Markdown files directly inside a Run folder, in Stage order.
/** @param {string} dir */
async function listMarkdown(dir) {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md') && SEGMENT.test(e.name))
      .map((e) => e.name)
      .sort(byStage);
  } catch {
    return [];
  }
}

/**
 * @typedef {{ id: string, unreadable: false, record: Run, files: string[], events: ReturnType<typeof readEvents> }} ReadableEntry
 * @typedef {{ id: string, unreadable: true, record: null, files: string[], events?: undefined }} UnreadableEntry
 */
/**
 * @param {string} runsDir
 * @returns {Promise<(ReadableEntry | UnreadableEntry)[]>}
 */
export async function listRuns(runsDir) {
  let entries;
  try {
    entries = await fs.promises.readdir(runsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  /** @type {(ReadableEntry | UnreadableEntry)[]} */
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const files = await listMarkdown(path.join(runsDir, entry.name));
    try {
      const record = JSON.parse(await fs.promises.readFile(path.join(runsDir, entry.name, 'run.json'), 'utf8'));
      if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new Error('not an object');
      runs.push({
        id: entry.name,
        unreadable: false,
        record,
        files,
        events: readEvents(path.join(runsDir, entry.name)),
      });
    } catch {
      runs.push({ id: entry.name, unreadable: true, record: null, files });
    }
  }
  return runs.sort((a, b) => a.id.localeCompare(b.id));
}

// Returns file contents, or null if the path is not a Markdown file inside a Run folder.
/**
 * @param {string} runsDir
 * @param {string} rawPath
 */
export async function readRunFile(runsDir, rawPath) {
  let parts;
  try {
    parts = rawPath.split('/').map(decodeURIComponent);
  } catch {
    return null;
  }
  if (parts.length !== 2 || !parts.every((p) => SEGMENT.test(p) && !p.startsWith('..'))) return null;
  if (!parts[1].endsWith('.md')) return null;
  try {
    const root = await fs.promises.realpath(runsDir);
    const file = await fs.promises.realpath(path.resolve(root, ...parts));
    if (!file.startsWith(root + path.sep)) return null;
    return await fs.promises.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** @param {string} root */
export const runIds = (root) =>
  fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && validId(e.name))
    .map((e) => e.name)
    .sort();

// Run records live in the main checkout, including when called from a linked worktree.
/** @param {string} dir */
export function mainCheckout(dir) {
  const out = spawnSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'],
    { cwd: dir, encoding: 'utf8' },
  );
  const [gitDir, common] = out.status === 0 ? out.stdout.trim().split('\n') : [];
  if (!gitDir || path.basename(common) !== '.git') return { dir };
  return { dir: path.dirname(common) };
}
