// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
export const projectId = (projectPath) => createHash('sha1').update(projectPath).digest('hex').slice(0, 8);

/** @param {string} file @param {unknown} value */
function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const staging = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(staging, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(staging, file);
  } catch (err) {
    fs.rmSync(staging, { force: true });
    throw err;
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 15;

/** @param {number} ms */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Runs fn while holding an exclusive lock file (created with `wx`) next to the registry, so two processes cannot both read the old list and drop each other's Project. A lock older than LOCK_STALE_MS belongs to a dead process and is taken over. Throws when the lock stays held for waitMs.
/** @template T @param {string} lockFile @param {number} waitMs @param {() => T} fn @returns {T} */
function withLock(lockFile, waitMs, fn) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lockFile, 'wx'));
      break;
    } catch (err) {
      if (codeOf(err) !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(lockFile).mtimeMs > LOCK_STALE_MS) fs.rmSync(lockFile, { force: true });
        else if (Date.now() >= deadline) throw new Error(`${lockFile} is locked by another process`);
        else sleep(LOCK_RETRY_MS);
      } catch (inner) {
        if (!isMissing(inner)) throw inner;
      }
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockFile, { force: true });
  }
}

// Owns projects.json (main checkout paths) and dashboard.json (pid, port and version of the running server) in one folder. Nothing here throws: a problem is passed to warn.
/** @param {{ dir?: string, warn?: (message: string) => void, lockWaitMs?: number }} [options] */
export function openProjectRegistry({ dir = factoryConfigDir(), warn = () => {}, lockWaitMs = LOCK_WAIT_MS } = {}) {
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
    list: () => read().paths.map((p) => ({ id: projectId(p), path: p })),
    /** Adds the main checkout of projectDir. @param {string} projectDir @returns {Project | undefined} */
    join(projectDir) {
      const main = mainCheckout(projectDir).dir;
      try {
        withLock(lockFile, lockWaitMs, () => {
          const { paths, corrupt } = read();
          if (corrupt) {
            fs.copyFileSync(registryFile, `${registryFile}.corrupt`);
            warn(`kept the unreadable registry as ${registryFile}.corrupt`);
          }
          if (!paths.includes(main)) save([...paths, main]);
        });
        return { id: projectId(main), path: main };
      } catch (err) {
        warn(`cannot register ${main} in ${registryFile}: ${messageOf(err)}`);
        return undefined;
      }
    },
    /** @param {string} id */
    remove(id) {
      try {
        return withLock(lockFile, lockWaitMs, () => {
          const { paths } = read();
          const kept = paths.filter((p) => projectId(p) !== id);
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
