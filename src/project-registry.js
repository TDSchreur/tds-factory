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
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  try {
    fs.chmodSync(dir, DIR_MODE);
  } catch {
    // best effort on hosts that do not apply POSIX modes
  }
}

/** @param {string} file @param {unknown} value */
function writeAtomic(file, value) {
  ensurePrivateDir(path.dirname(file));
  const text = `${JSON.stringify(value, null, 2)}\n`;
  for (;;) {
    const staging = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
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

/** @param {string} lockFile */
const lockToken = (lockFile) => `${process.pid}:${randomBytes(16).toString('hex')}:${path.basename(lockFile)}`;

/** @param {string} lockFile */
const takeoverLockName = (lockFile) => `${lockFile}.stale-${process.pid}-${randomBytes(8).toString('hex')}`;

/** @param {string} lockFile */
function tryTakeOverStaleLock(lockFile) {
  const age = Date.now() - fs.statSync(lockFile).mtimeMs;
  if (age <= LOCK_STALE_MS) return false;
  const takeover = takeoverLockName(lockFile);
  fs.renameSync(lockFile, takeover);
  fs.rmSync(takeover, { force: true });
  return true;
}

/**
 * @param {string} lockFile
 * @param {number} waitMs
 * @param {(ms: number) => void} wait
 */
function acquireLockSync(lockFile, waitMs, wait) {
  ensurePrivateDir(path.dirname(lockFile));
  const token = lockToken(lockFile);
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(lockFile, token, { flag: 'wx', mode: FILE_MODE });
      return token;
    } catch (err) {
      if (codeOf(err) !== 'EEXIST') throw err;
      try {
        if (!tryTakeOverStaleLock(lockFile) && Date.now() >= deadline)
          throw new Error(`${lockFile} is locked by another process`);
      } catch (inner) {
        if (!isMissing(inner)) throw inner;
      }
      wait(LOCK_RETRY_MS);
    }
  }
}

/**
 * @param {string} lockFile
 * @param {number} waitMs
 * @param {(ms: number) => Promise<void>} wait
 */
async function acquireLockAsync(lockFile, waitMs, wait) {
  ensurePrivateDir(path.dirname(lockFile));
  const token = lockToken(lockFile);
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(lockFile, token, { flag: 'wx', mode: FILE_MODE });
      return token;
    } catch (err) {
      if (codeOf(err) !== 'EEXIST') throw err;
      try {
        if (!tryTakeOverStaleLock(lockFile) && Date.now() >= deadline)
          throw new Error(`${lockFile} is locked by another process`);
      } catch (inner) {
        if (!isMissing(inner)) throw inner;
      }
      await wait(LOCK_RETRY_MS);
    }
  }
}

/** @param {string} lockFile @param {string} token */
function releaseLock(lockFile, token) {
  try {
    if (fs.readFileSync(lockFile, 'utf8') === token) fs.rmSync(lockFile, { force: true });
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
}

// Runs fn while holding an exclusive lock file (created with `wx`) next to the registry, so two processes cannot both read the old list and drop each other's Project. A lock older than LOCK_STALE_MS belongs to a dead process and is taken over. Throws when the lock stays held for waitMs.
/** @template T @param {string} lockFile @param {number} waitMs @param {() => T} fn @returns {T} */
function withLock(lockFile, waitMs, fn) {
  const token = acquireLockSync(lockFile, waitMs, sleep);
  try {
    return fn();
  } finally {
    releaseLock(lockFile, token);
  }
}

// Owns projects.json (main checkout paths) and dashboard.json (pid, port and version of the running server) in one folder. Nothing here throws: a problem is passed to warn.
/** @template T @param {string} lockFile @param {number} waitMs @param {() => Promise<T>} fn @returns {Promise<T>} */
async function withLockAsync(lockFile, waitMs, fn) {
  const token = await acquireLockAsync(lockFile, waitMs, sleepAsync);
  try {
    return await fn();
  } finally {
    releaseLock(lockFile, token);
  }
}

// Owns projects.json (main checkout paths) and dashboard.json (pid, port and version of the running server) in one folder. Nothing here throws: a problem is passed to warn.
/** @param {{ dir?: string, warn?: (message: string) => void, lockWaitMs?: number, idOf?: (projectPath: string) => string }} [options] */
export function openProjectRegistry({
  dir = factoryConfigDir(),
  warn = () => {},
  lockWaitMs = LOCK_WAIT_MS,
  idOf = projectId,
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
  const save = (paths) => writeAtomic(registryFile, { projects: paths });

  return {
    dir,
    /** @returns {Project[]} */
    list: () => read().paths.map((p) => ({ id: idOf(p), path: p })),
    /** Adds the main checkout of projectDir. @param {string} projectDir @returns {Project | undefined} */
    join(projectDir) {
      try {
        const main = mainCheckout(projectDir).dir;
        const id = idOf(main);
        withLock(lockFile, lockWaitMs, () => {
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
        });
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
        return withLock(lockFile, lockWaitMs, () => {
          const { paths } = read();
          const kept = paths.filter((p) => idOf(p) !== id);
          if (kept.length === paths.length) return false;
          save(kept);
          return true;
        });
      } catch (err) {
        warn(`cannot update ${registryFile}: ${messageOf(err)}`);
        return false;
      }
    },
    /** @param {string} id */
    async removeAsync(id) {
      try {
        return await withLockAsync(lockFile, lockWaitMs, async () => {
          const { paths } = read();
          const kept = paths.filter((p) => idOf(p) !== id);
          if (kept.length === paths.length) return false;
          save(kept);
          return true;
        });
      } catch (err) {
        warn(`cannot update ${registryFile}: ${messageOf(err)}`);
        return false;
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
        writeAtomic(stateFile, state);
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
