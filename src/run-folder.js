import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
/** @import { Run } from './run-record.js' */
/** @import { Step } from './git.js' */
import { callStep, git, immediate, runSync } from './git.js';
import { codeOf, isMissing } from './narrow.js';
import { stages, stageIndex } from './flow.js';
import { validId, validate, write, withStageModel } from './run-record.js';
import { appendEvent, deriveEvents, readEventsAsync } from './run-events.js';
import { withUsage } from './run-usage.js';
import { parseMarkdown } from '../dashboard/markdown.js';

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
    // A lock file that cannot be read has an unknown owner; callers never clear an unknown lock.
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
  const release = acquireLock(lock);
  try {
    return action();
  } finally {
    release();
  }
}
// Takes the lock file and returns what releases it, so a flow can hold the lock across its awaited git calls.
/** @param {string} lock */
export function acquireLock(lock) {
  const fd = fs.openSync(lock, 'wx', 0o600);
  const identity = fs.fstatSync(fd);
  const release = () => {
    fs.closeSync(fd);
    try {
      const current = fs.lstatSync(lock);
      if (current.dev === identity.dev && current.ino === identity.ino) fs.unlinkSync(lock);
    } catch (err) {
      if (codeOf(err) !== 'ENOENT') throw err;
    }
  };
  try {
    fs.writeFileSync(
      fd,
      JSON.stringify({ pid: process.pid, host: os.hostname(), started: new Date().toISOString() }) + '\n',
    );
  } catch (err) {
    release();
    throw err;
  }
  return release;
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
// The same lock for a flow that runs git calls while it holds the lock.
/**
 * @template T
 * @param {string} root
 * @param {string} id
 * @param {() => Generator<Step, T, any>} body
 * @returns {Generator<Step, T, any>}
 */
export function* withRunLockFlow(root, id, body) {
  const release = yield* callStep(() => acquireLock(lockFile(root, id)));
  try {
    return yield* body();
  } finally {
    release();
  }
}

// A Run's folder and record, refusing links anywhere on the way.
/**
 * @param {string} projectDir
 * @param {string | undefined} id
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
// Reads a Run record under its lock, hands it to change, and writes back what change returns. A flow's change may yield git calls.
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {(old: Run) => Generator<Step, Run, any>} change
 * @returns {Generator<Step, void, any>}
 */
export function* changeRunFlow(projectDir, id, change) {
  if (!validId(id)) throw new Error('invalid Run id');
  yield* withRunLockFlow(runRoot(projectDir, false), id, function* () {
    const { dir, record } = readRun(projectDir, id);
    const changed = yield* change(record);
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
// Reads a Run record under its lock, hands it to change, and writes back what change returns.
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {(old: Run) => Run} change
 */
export const changeRun = (projectDir, id, change) =>
  runSync(changeRunFlow(projectDir, id, (old) => immediate(change(old))));

/** @typedef {(old: Run) => { record: Run, activity: string }} Move */
// Changes a running Run for a named operation, which takes only an optional activity line besides its own arguments.
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {{ activity?: string }} data
 * @param {(old: Run) => Generator<Step, { record: Run, activity: string }, any>} move
 * @returns {Generator<Step, void, any>}
 */
export function* changeRunningFlow(projectDir, id, data, move) {
  validate(data);
  if (Object.keys(data).some((key) => key !== 'activity')) throw new Error('this operation accepts only activity');
  yield* changeRunFlow(projectDir, id, function* (old) {
    if (old.status !== 'running') throw new Error(`a ${old.status} Run cannot be changed this way, only a running one`);
    const { record, activity } = yield* move(old);
    return { ...record, activity: data.activity ?? activity, updated: new Date().toISOString() };
  });
}
// Changes a running Run for a named operation, which takes only an optional activity line besides its own arguments.
/**
 * @param {string} projectDir
 * @param {string | undefined} id
 * @param {{ activity?: string }} data
 * @param {Move} move
 */
export const changeRunning = (projectDir, id, data, move) =>
  runSync(changeRunningFlow(projectDir, id, data, (old) => immediate(move(old))));

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
  } catch (err) {
    if (!isMissing(err)) throw err;
    return [];
  }
}

/**
 * @typedef {{ id: string, unreadable: false, record: Run, files: string[], events: Awaited<ReturnType<typeof readEventsAsync>> }} ReadableEntry
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
  } catch (err) {
    if (!isMissing(err)) throw err;
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
        events: await readEventsAsync(path.join(runsDir, entry.name)),
      });
    } catch {
      // A record that cannot be read or parsed is listed as unreadable, which is how the Dashboard shows it.
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
    // A malformed escape in the path is no file.
    return null;
  }
  if (parts.length !== 2 || !parts.every((p) => SEGMENT.test(p) && !p.startsWith('..'))) return null;
  if (!parts[1].endsWith('.md')) return null;
  try {
    const root = await fs.promises.realpath(runsDir);
    const file = await fs.promises.realpath(path.resolve(root, ...parts));
    if (!file.startsWith(root + path.sep)) return null;
    return await fs.promises.readFile(file, 'utf8');
  } catch (err) {
    if (!isMissing(err)) throw err;
    return null;
  }
}

// A Linked document is a relative Markdown path that the Run record lists in `spec_link` or `tickets` (ADR 0038); the listing is the main defense, the path checks are a second layer.
/** @param {unknown} value */
const listedPaths = (value) => (Array.isArray(value) ? value : [value]).filter((v) => typeof v === 'string');
/** @param {string} p */
const safeRelative = (p) =>
  p.length > 0 &&
  p.length <= 1024 &&
  p.endsWith('.md') &&
  !p.includes('\\') &&
  !p.includes('\0') &&
  !p.startsWith('/') &&
  !/^[A-Za-z]:/.test(p) &&
  !p.split('/').some((segment) => segment === '' || segment === '..');

const MAX_DOCUMENT_BYTES = 1024 * 1024;
// Windows has neither flag; there only the dev/ino comparison in openLinkedFile guards the open.
const OPEN_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);

/** @param {unknown} err */
const isRefusal = (err) => isMissing(err) || ['ENOTDIR', 'EISDIR', 'ELOOP', 'ENXIO'].includes(String(codeOf(err)));

/**
 * The real path of `rel` inside `root` when it is a regular file there, or null when it is missing, leads outside the root (a symlink) or is a directory, FIFO, device or socket.
 * @param {string} root
 * @param {string} rel
 */
async function locateInside(root, rel) {
  try {
    const real = await fs.promises.realpath(root);
    const file = await fs.promises.realpath(path.resolve(real, rel));
    if (!file.startsWith(real + path.sep)) return null;
    return (await fs.promises.stat(file)).isFile() ? file : null;
  } catch (err) {
    if (!isRefusal(err)) throw err;
    return null;
  }
}

// The Run worktree is a root only when the record names it as an absolute path whose real path is under the Project's .factory/worktrees/ (ADR 0038); anything else is skipped.
/** @param {string} projectDir @param {unknown} worktree */
async function worktreeRoot(projectDir, worktree) {
  if (typeof worktree !== 'string' || !path.isAbsolute(worktree)) return '';
  try {
    const base = await fs.promises.realpath(path.join(projectDir, '.factory', 'worktrees'));
    const real = await fs.promises.realpath(worktree);
    return real.startsWith(base + path.sep) ? real : '';
  } catch (err) {
    if (!isRefusal(err)) throw err;
    return '';
  }
}

/** @typedef {(file: string, flags: number) => Promise<Pick<fs.promises.FileHandle, 'stat' | 'read' | 'close'>>} OpenFile */

// The one open step of Linked documents. Opens without following a final symlink and without blocking on a FIFO, then confirms the opened file is a regular file of at most `limit` bytes and the one `stat` showed just before (same dev and ino, read as bigint so Windows file indexes compare exactly). Returns null for every refusal.
/**
 * @param {string} file The real path located by locateInside.
 * @param {{ open?: OpenFile, limit?: number }} [options]
 */
async function openLinkedFile(file, { open = fs.promises.open, limit = MAX_DOCUMENT_BYTES } = {}) {
  let handle;
  try {
    const before = await fs.promises.stat(file, { bigint: true });
    handle = await open(file, OPEN_FLAGS);
    const opened = await handle.stat({ bigint: true });
    if (opened.isFile() && opened.dev === before.dev && opened.ino === before.ino && Number(opened.size) <= limit)
      return { handle, size: Number(opened.size) };
  } catch (err) {
    if (!isRefusal(err)) {
      await handle?.close();
      throw err;
    }
  }
  await handle?.close();
  return null;
}

// The one resolution of a Linked document, shared by the document route and the titles: the allow-list of the Run record, the path checks, the Run worktree, then the main checkout, then (Spec only) docs/specs/archive/ of the main checkout. Returns the real path of a regular file, or null for every refusal.
/**
 * @param {string} projectDir The main checkout.
 * @param {Record<string, unknown>} record
 * @param {string} rel The path as the record lists it.
 */
export async function locateLinkedDocument(projectDir, record, rel) {
  const isSpec = listedPaths(record.spec_link).includes(rel);
  if (!isSpec && !listedPaths(record.tickets).includes(rel)) return null;
  if (!safeRelative(rel)) return null;
  const roots = [await worktreeRoot(projectDir, record.worktree), projectDir].filter(Boolean);
  for (const root of roots) {
    const file = await locateInside(root, rel);
    if (file !== null) return file;
  }
  if (!isSpec) return null;
  return locateInside(projectDir, `docs/specs/archive/${path.posix.basename(rel)}`);
}

// Returns the Markdown of a document the Run lists, or null for every refusal.
/**
 * @param {string} projectDir The main checkout.
 * @param {string} runId
 * @param {string} rawPath The path as requested, percent-encoded per segment; decoded once here.
 * @param {{ open?: OpenFile }} [options]
 */
export async function readLinkedDocument(projectDir, runId, rawPath, { open } = {}) {
  if (!validId(runId)) return null;
  let rel;
  try {
    const parts = rawPath.split('/').map(decodeURIComponent);
    // An encoded separator is no separator: the listed path has real ones.
    if (parts.some((part) => part.includes('/') || part.includes('\\'))) return null;
    rel = parts.join('/');
  } catch {
    // A malformed escape in the path is no document.
    return null;
  }
  let record;
  try {
    record = readRun(projectDir, runId).record;
  } catch {
    // An unknown Run or an unreadable record lists no document.
    return null;
  }
  const file = await locateLinkedDocument(projectDir, record, rel);
  if (file === null) return null;
  const opened = await openLinkedFile(file, { open });
  if (opened === null) return null;
  try {
    const buffer = Buffer.alloc(opened.size);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await opened.handle.read(buffer, filled, buffer.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return buffer.subarray(0, filled).toString('utf8');
  } finally {
    await opened.handle.close();
  }
}

const TITLE_BYTES = 4096;
const TITLE_CHARS = 120;
const TITLE_CACHE_MAX = 500;

/** @param {import('../dashboard/markdown.js').Span[]} spans @returns {string} */
const plainText = (spans) => spans.map((span) => ('v' in span ? span.v : plainText(span.c))).join('');

/**
 * The title of a Markdown head: the first level 1 heading with text outside fenced code, as plain text; '' when there is none.
 * @param {string} head
 */
export function titleOf(head) {
  for (const block of parseMarkdown(head)) {
    if (block.type !== 'heading' || block.level !== 1) continue;
    const text = plainText(block.inline)
      .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return Array.from(text).slice(0, TITLE_CHARS).join('').trim();
  }
  return '';
}

/** @param {string} file */
async function readHead(file) {
  const opened = await openLinkedFile(file, { limit: Infinity });
  if (opened === null) return '';
  try {
    const buffer = Buffer.alloc(TITLE_BYTES);
    const { bytesRead } = await opened.handle.read(buffer, 0, TITLE_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await opened.handle.close();
  }
}

/**
 * The link text of the local Linked documents of Runs. Two caches: the title per real path, size and modification time (at most `max` entries, least recently used out first), and the located real path (or not-found) per Run and listed document, dropped when the record's `updated` changes.
 * @param {{ max?: number, read?: (file: string) => Promise<string>, locate?: typeof locateLinkedDocument }} [options]
 */
export function createLinkedTitles({ max = TITLE_CACHE_MAX, read = readHead, locate = locateLinkedDocument } = {}) {
  /** @type {Map<string, { size: number, mtimeMs: number, title: string }>} */
  const cache = new Map();
  /** @type {Map<string, { updated: unknown, paths: Map<string, string | null> }>} */
  const located = new Map();
  /** @param {string} file @param {fs.Stats} stat */
  async function titleOfFile(file, stat) {
    const hit = cache.get(file);
    if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) {
      cache.delete(file);
      cache.set(file, hit);
      return hit.title;
    }
    const title = titleOf(await read(file));
    cache.delete(file);
    cache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, title });
    while (cache.size > max) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return title;
  }
  /** @param {string} file @returns {Promise<string | null>} The file when its real path is itself, else null. */
  async function cachedRealPath(file) {
    try {
      return (await fs.promises.realpath(file)) === file ? file : null;
    } catch (err) {
      if (!isRefusal(err)) throw err;
      return null;
    }
  }
  /** @param {string} file */
  async function statRegular(file) {
    try {
      const stat = await fs.promises.stat(file);
      return stat.isFile() ? stat : null;
    } catch (err) {
      if (!isRefusal(err)) throw err;
      return null;
    }
  }
  return {
    size: () => cache.size,
    /**
     * Label per listed local document that has a title: the title, with the digits of the file name in front. A document that is not found, has no heading or cannot be read has no entry.
     * @param {string} projectDir The main checkout.
     * @param {unknown} record
     * @param {string} [runId] Names the Run whose located paths are cached.
     * @returns {Promise<Record<string, string>>}
     */
    async of(projectDir, record, runId) {
      if (!record || typeof record !== 'object') return {};
      const rec = /** @type {Record<string, unknown>} */ (record);
      let entry = runId === undefined ? undefined : located.get(runId);
      if (runId !== undefined && entry?.updated !== rec.updated) {
        entry = { updated: rec.updated, paths: new Map() };
        located.set(runId, entry);
      }
      /** @type {Map<string, string>} */
      const titles = new Map();
      for (const rel of new Set([...listedPaths(rec.spec_link), ...listedPaths(rec.tickets)])) {
        try {
          const known = entry?.paths.get(rel);
          // A cached path is used only while its real path is still itself, so a symlink swapped in later is located again.
          let file = known ? await cachedRealPath(known) : null;
          let stat = file === null ? null : await statRegular(file);
          if (known === null) continue;
          if (stat === null || file === null) {
            file = await locate(projectDir, rec, rel);
            stat = file === null ? null : await statRegular(file);
            if (file === null || stat === null) {
              // Not found stays not found until the Run record changes.
              entry?.paths.set(rel, null);
              continue;
            }
            entry?.paths.set(rel, file);
          }
          const title = await titleOfFile(file, stat);
          if (!title) continue;
          const digits = /^(\d{1,6})-/.exec(path.posix.basename(rel))?.[1];
          titles.set(rel, digits ? `${digits} ${title}` : title);
        } catch {
          // A document that cannot be read keeps its file name as link text.
        }
      }
      return Object.fromEntries(titles);
    },
  };
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
  const out = git(dir, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel']);
  const [gitDir, common] = out.status === 0 ? out.stdout.trim().split('\n') : [];
  if (!gitDir || !common || path.basename(common) !== '.git') return { dir: path.normalize(dir) };
  // git prints forward slashes on Windows; the Project id hashes this path, so use the native form.
  return { dir: path.normalize(path.dirname(common)) };
}
