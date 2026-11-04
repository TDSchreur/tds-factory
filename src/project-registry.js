// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { mainCheckout } from './run-folder.js';
import { codeOf, isMissing, messageOf } from './narrow.js';

/** @typedef {{ id: string, path: string }} Project */
/** @typedef {{ pid: number, port: number, version: string }} DashboardState */

/** The user's Factory config folder, outside every repository. @param {{ env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, home?: string }} [options] */
export function factoryConfigDir({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.TDS_FACTORY_CONFIG_DIR) return env.TDS_FACTORY_CONFIG_DIR;
  if (platform === 'win32' && env.APPDATA) return path.join(env.APPDATA, 'tds-factory');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'tds-factory');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'tds-factory');
}

/** A short hash of the main checkout path. @param {string} projectPath */
export const projectId = (projectPath) => createHash('sha1').update(projectPath).digest('hex').slice(0, 12);

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** @param {string} dir */
function ensurePrivateDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  if (process.platform === 'win32') return;
  try {
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink()) return;
    const mode = stat.mode & 0o777;
    if ((mode & 0o077) !== 0) fs.chmodSync(dir, DIR_MODE);
  } catch {
    // best effort on hosts that do not apply POSIX modes
  }
}

/**
 * @param {string} file
 * @param {unknown} value
 * @param {() => string} stagingHex
 */
function writeAtomic(file, value, stagingHex) {
  ensurePrivateDir(path.dirname(file));
  const text = `${JSON.stringify(value, null, 2)}\n`;
  for (;;) {
    const staging = `${file}.${process.pid}.${stagingHex()}.tmp`;
    try {
      fs.writeFileSync(staging, text, { flag: 'wx', mode: FILE_MODE });
      fs.renameSync(staging, file);
      try {
        fs.chmodSync(file, FILE_MODE);
      } catch {
        // best effort on hosts that do not apply POSIX modes
      }
      return;
    } catch (err) {
      fs.rmSync(staging, { force: true });
      if (codeOf(err) === 'EEXIST') continue;
      throw err;
    }
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 15;

/** @param {number} ms */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** @param {number} ms */
const sleepAsync = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A lock file that another process just removed stays "delete pending" on Windows until its last handle closes. In that
// window creating or reading it fails with EPERM (sometimes EACCES or EBUSY) instead of EEXIST or ENOENT, so there the
// lock counts as held and the caller retries until the lock wait ends. Elsewhere only EEXIST means held.
/** @param {unknown} err @param {NodeJS.Platform} platform */
const lockBusy = (err, platform) => {
  const code = codeOf(err);
  return code === 'EEXIST' || (platform === 'win32' && (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'));
};

/** @param {string} lockFile */
const lockToken = (lockFile) => `${process.pid}:${randomBytes(16).toString('hex')}:${path.basename(lockFile)}`;

/** @param {string} lockFile */
const takeoverGuard = (lockFile) => `${lockFile}.takeover`;

/**
 * @param {string} file
 * @returns {{ token: string, mtimeMs: number } | undefined}
 */
function readLockSnapshot(file) {
  try {
    return {
      token: fs.readFileSync(file, 'utf8'),
      mtimeMs: fs.statSync(file).mtimeMs,
    };
  } catch (err) {
    if (!isMissing(err)) throw err;
    return undefined;
  }
}

/**
 * @param {string} file
 * @param {string} token
 * @param {number} mtimeMs
 */
function removeIfMatches(file, token, mtimeMs) {
  // The read-then-remove gap is inherent to filesystem locks; it is bounded here by matching the stale snapshot
  // (token + mtime) and by only using this path for stale takeover.
  const seen = readLockSnapshot(file);
  if (!seen || seen.token !== token || seen.mtimeMs !== mtimeMs) return false;
  fs.rmSync(file, { force: true });
  return true;
}

/** @param {string} guardFile @param {NodeJS.Platform} platform */
function acquireTakeoverGuard(guardFile, platform) {
  const token = lockToken(guardFile);
  try {
    fs.writeFileSync(guardFile, token, { flag: 'wx', mode: FILE_MODE });
    return token;
  } catch (err) {
    if (!lockBusy(err, platform)) throw err;
  }
  const seen = readLockSnapshot(guardFile);
  if (!seen) return undefined;
  if (Date.now() - seen.mtimeMs > LOCK_STALE_MS) removeIfMatches(guardFile, seen.token, seen.mtimeMs);
  return undefined;
}

/**
 * @param {string} lockFile
 * @param {string} token
 * @param {(ctx: { lockFile: string, staleToken: string, staleMtimeMs: number }) => void} onBeforeStaleTakeover
 * @param {NodeJS.Platform} platform
 */
function tryTakeOverStaleLock(lockFile, token, onBeforeStaleTakeover, platform) {
  const stale = readLockSnapshot(lockFile);
  if (!stale) return false;
  if (Date.now() - stale.mtimeMs <= LOCK_STALE_MS) return false;
  const guardFile = takeoverGuard(lockFile);
  const guardToken = acquireTakeoverGuard(guardFile, platform);
  if (!guardToken) return false;
  try {
    const current = readLockSnapshot(lockFile);
    if (!current) return false;
    if (Date.now() - current.mtimeMs <= LOCK_STALE_MS) return false;
    if (current.token !== stale.token || current.mtimeMs !== stale.mtimeMs) return false;
    onBeforeStaleTakeover({
      lockFile,
      staleToken: current.token,
      staleMtimeMs: current.mtimeMs,
    });
    if (!removeIfMatches(lockFile, current.token, current.mtimeMs)) return false;
    try {
      fs.writeFileSync(lockFile, token, { flag: 'wx', mode: FILE_MODE });
      return true;
    } catch (err) {
      if (lockBusy(err, platform)) return false;
      throw err;
    }
  } finally {
    releaseLock(guardFile, guardToken, platform);
  }
}

/**
 * @param {string} lockFile
 * @param {number} waitMs
 * @param {(ms: number) => void} wait
 * @param {(ctx: { lockFile: string, staleToken: string, staleMtimeMs: number }) => void} onBeforeStaleTakeover
 * @param {NodeJS.Platform} platform
 */
function acquireLockSync(lockFile, waitMs, wait, onBeforeStaleTakeover, platform) {
  ensurePrivateDir(path.dirname(lockFile));
  const token = lockToken(lockFile);
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(lockFile, token, { flag: 'wx', mode: FILE_MODE });
      return token;
    } catch (err) {
      if (!lockBusy(err, platform)) throw err;
      const now = Date.now();
      try {
        if (tryTakeOverStaleLock(lockFile, token, onBeforeStaleTakeover, platform)) return token;
      } catch (inner) {
        if (!isMissing(inner) && !lockBusy(inner, platform)) throw inner;
      }
      if (now >= deadline) throw new Error(`${lockFile} is locked by another process`);
      wait(LOCK_RETRY_MS);
    }
  }
}

/**
 * @param {string} lockFile
 * @param {number} waitMs
 * @param {(ms: number) => Promise<void>} wait
 * @param {(ctx: { lockFile: string, staleToken: string, staleMtimeMs: number }) => void} onBeforeStaleTakeover
 * @param {NodeJS.Platform} platform
 */
async function acquireLockAsync(lockFile, waitMs, wait, onBeforeStaleTakeover, platform) {
  ensurePrivateDir(path.dirname(lockFile));
  const token = lockToken(lockFile);
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(lockFile, token, { flag: 'wx', mode: FILE_MODE });
      return token;
    } catch (err) {
      if (!lockBusy(err, platform)) throw err;
      const now = Date.now();
      try {
        if (tryTakeOverStaleLock(lockFile, token, onBeforeStaleTakeover, platform)) return token;
      } catch (inner) {
        if (!isMissing(inner) && !lockBusy(inner, platform)) throw inner;
      }
      if (now >= deadline) throw new Error(`${lockFile} is locked by another process`);
      await wait(LOCK_RETRY_MS);
    }
  }
}

/** @param {string} lockFile @param {string} token @param {NodeJS.Platform} platform */
function releaseLock(lockFile, token, platform) {
  try {
    if (fs.readFileSync(lockFile, 'utf8') === token) fs.rmSync(lockFile, { force: true });
  } catch (err) {
    // Best effort on Windows: a lock that is still delete pending is gone for the next process once its handles close.
    if (!isMissing(err) && !(platform === 'win32' && lockBusy(err, platform))) throw err;
  }
}

// Runs fn while holding an exclusive lock file (created with `wx`) next to the registry, so two processes cannot both read the old list and drop each other's Project. A lock older than LOCK_STALE_MS belongs to a dead process and is taken over. Throws when the lock stays held for waitMs.
/**
 * @template T
 * @param {string} lockFile
 * @param {number} waitMs
 * @param {(ctx: { lockFile: string, staleToken: string, staleMtimeMs: number }) => void} onBeforeStaleTakeover
 * @param {(ctx: { lockFile: string, token: string }) => void} onLockAcquired
 * @param {() => T} fn
 * @param {NodeJS.Platform} platform
 * @returns {T}
 */
function withLock(lockFile, waitMs, onBeforeStaleTakeover, onLockAcquired, fn, platform) {
  const token = acquireLockSync(lockFile, waitMs, sleep, onBeforeStaleTakeover, platform);
  try {
    onLockAcquired({ lockFile, token });
    return fn();
  } finally {
    releaseLock(lockFile, token, platform);
  }
}

/** @template T @param {string} lockFile @param {number} waitMs @param {(ctx: { lockFile: string, staleToken: string, staleMtimeMs: number }) => void} onBeforeStaleTakeover @param {(ctx: { lockFile: string, token: string }) => void | Promise<void>} onLockAcquired @param {() => Promise<T>} fn @param {NodeJS.Platform} platform @returns {Promise<T>} */
async function withLockAsync(lockFile, waitMs, onBeforeStaleTakeover, onLockAcquired, fn, platform) {
  const token = await acquireLockAsync(lockFile, waitMs, sleepAsync, onBeforeStaleTakeover, platform);
  try {
    await onLockAcquired({ lockFile, token });
    return await fn();
  } finally {
    releaseLock(lockFile, token, platform);
  }
}

// Owns projects.json (main checkout paths) and dashboard.json (pid, port and version of the running server) in one folder. Nothing here throws: a problem is passed to warn.
/** @param {{ dir?: string, warn?: (message: string) => void, lockWaitMs?: number, idOf?: (projectPath: string) => string, stagingHex?: () => string, onBeforeStaleTakeover?: (ctx: { lockFile: string, staleToken: string, staleMtimeMs: number }) => void, onLockAcquired?: (ctx: { lockFile: string, token: string }) => void | Promise<void>, platform?: NodeJS.Platform }} [options] */
export function openProjectRegistry({
  dir = factoryConfigDir(),
  warn = () => {},
  lockWaitMs = LOCK_WAIT_MS,
  idOf = projectId,
  stagingHex = () => randomBytes(8).toString('hex'),
  onBeforeStaleTakeover = () => {},
  onLockAcquired = () => {},
  platform = process.platform,
} = {}) {
  const registryFile = path.join(dir, 'projects.json');
  const lockFile = `${registryFile}.lock`;
  const stateFile = path.join(dir, 'dashboard.json');

  /** @returns {{ paths: string[], corrupt: boolean }} */
  const read = () => {
    let text;
    try {
      text = fs.readFileSync(registryFile, 'utf8');
    } catch (err) {
      if (!isMissing(err)) warn(`cannot read ${registryFile}: ${messageOf(err)}`);
      return { paths: [], corrupt: false };
    }
    try {
      const data = JSON.parse(text);
      if (isRecord(data) && Array.isArray(data.projects) && data.projects.every((p) => typeof p === 'string'))
        return { paths: data.projects, corrupt: false };
    } catch {
      // handled below, like a file of the wrong shape
    }
    warn(`${registryFile} is not a Project registry; treating it as empty`);
    return { paths: [], corrupt: true };
  };

  /** @param {string[]} paths */
  const save = (paths) => writeAtomic(registryFile, { projects: paths }, stagingHex);

  return {
    dir,
    /** @returns {Project[]} */
    list: () => read().paths.map((p) => ({ id: idOf(p), path: p })),
    /** Adds the main checkout of projectDir. @param {string} projectDir @returns {Project | undefined} */
    join(projectDir) {
      try {
        const main = mainCheckout(projectDir).dir;
        const id = idOf(main);
        withLock(
          lockFile,
          lockWaitMs,
          onBeforeStaleTakeover,
          onLockAcquired,
          () => {
            const { paths, corrupt } = read();
            if (corrupt) {
              fs.copyFileSync(registryFile, `${registryFile}.corrupt`);
              warn(`kept the unreadable registry as ${registryFile}.corrupt`);
            }
            const collision = paths.find((p) => p !== main && idOf(p) === id);
            if (collision) {
              warn(`cannot register ${main} in ${registryFile}: ${collision} has the same id (${id})`);
              return;
            }
            if (!paths.includes(main)) save([...paths, main]);
          },
          platform,
        );
        if (read().paths.includes(main)) return { id, path: main };
        return undefined;
      } catch (err) {
        warn(`cannot register ${projectDir} in ${registryFile}: ${messageOf(err)}`);
        return undefined;
      }
    },
    /** @param {string} id */
    remove(id) {
      try {
        return withLock(
          lockFile,
          lockWaitMs,
          onBeforeStaleTakeover,
          onLockAcquired,
          () => {
            const { paths } = read();
            const kept = paths.filter((p) => idOf(p) !== id);
            if (kept.length === paths.length) return false;
            save(kept);
            return true;
          },
          platform,
        );
      } catch (err) {
        warn(`cannot update ${registryFile}: ${messageOf(err)}`);
        return false;
      }
    },
    /** @param {string} id */
    async removeAsync(id) {
      try {
        return await withLockAsync(
          lockFile,
          lockWaitMs,
          onBeforeStaleTakeover,
          onLockAcquired,
          async () => {
            const { paths } = read();
            const kept = paths.filter((p) => idOf(p) !== id);
            if (kept.length === paths.length) return false;
            save(kept);
            return true;
          },
          platform,
        );
      } catch (err) {
        warn(`cannot update ${registryFile}: ${messageOf(err)}`);
        return false;
      }
    },
    /** Removes every registry entry whose folder is currently missing. @returns {Promise<string[]>} */
    async removeMissingAsync() {
      try {
        return await withLockAsync(
          lockFile,
          lockWaitMs,
          onBeforeStaleTakeover,
          onLockAcquired,
          async () => {
            const { paths } = read();
            const gone = new Set(paths.filter((p) => !fs.existsSync(p)));
            const removed = paths.filter((p) => gone.has(p));
            if (!removed.length) return [];
            const kept = paths.filter((p) => !gone.has(p));
            save(kept);
            return removed;
          },
          platform,
        );
      } catch (err) {
        warn(`cannot update ${registryFile}: ${messageOf(err)}`);
        return [];
      }
    },
    /** @returns {DashboardState | undefined} */
    readState() {
      try {
        const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        if (
          isRecord(data) &&
          Number.isInteger(data.pid) &&
          Number.isInteger(data.port) &&
          typeof data.version === 'string'
        )
          return { pid: Number(data.pid), port: Number(data.port), version: data.version };
      } catch {
        // an absent or damaged state file is a stale one
      }
      return undefined;
    },
    /** @param {DashboardState} state */
    writeState(state) {
      try {
        writeAtomic(stateFile, state, stagingHex);
      } catch (err) {
        warn(`cannot write ${stateFile}: ${messageOf(err)}`);
      }
    },
    /** Removes the state file when it still names this pid. @param {number} pid */
    clearState(pid) {
      if (this.readState()?.pid === pid) fs.rmSync(stateFile, { force: true });
    },
  };
}
