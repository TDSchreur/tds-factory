import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

/** @import { IncomingMessage } from 'node:http' */
/** @import { AddressInfo } from 'node:net' */

// A Run as the stub server's /api/views serves it. A test adds whatever fields the Dashboard reads, so the shape is open.
/** @typedef {{ id: string, title: string, column: string, status: string, updated: string, files: unknown[], links: unknown[], [field: string]: any }} RunStub */
// (any: the fields beyond the base ones are the test's own fixture data)

/**
 * @typedef {object} PageState What the stub server serves and records.
 * @property {RunStub[]} [runs] Served as /api/views.
 * @property {Record<string, string>} [files] Served as /files/<run>/<name>.
 * @property {(req: IncomingMessage) => { status: number, body: string, headers?: Record<string, string> } | undefined} [respond] Answers DELETE and POST requests.
 * @property {string} [checks] The text of /api/projects/p/runs/<id>/merge-checks.
 * @property {string[]} [statusCalls] The pr-status URLs that were read.
 * @property {() => void} [statusReply] Runs on each pr-status read.
 * @property {unknown} [statusBody] The JSON of a pr-status read.
 * @property {boolean} [failViews] Makes /api/views answer 500.
 * @property {string} [project]
 * @property {string} [version]
 */

// A value that comes back from WebDriver (the result of a script run in the page) has no type the test can know in advance.
/** @typedef {any} PageValue */

/** @typedef {PageState & { runs: RunStub[], files: Record<string, string> }} ServedState The state once openPage has filled in what the stub server serves. */

/**
 * @typedef {object} Page The handle openPage returns.
 * @property {number | undefined} driverPid
 * @property {string} tmp The private temp directory of this session.
 * @property {string[] | null} leftovers What ChromeDriver and Chromium left in tmp; null until close() has run.
 * @property {ServedState} state
 * @property {string[]} calls The non-GET requests the stub server received, as "METHOD url".
 * @property {(string | string[] | undefined)[]} tokens The X-Factory-Token header of each write.
 * @property {(script: string, scriptArgs?: unknown[]) => Promise<PageValue>} execute Runs a script body in the page; `return` hands back a value.
 * @property {() => Promise<void>} close
 * @property {() => Promise<string>} screenshot A base64 PNG.
 * @property {(script: string) => Promise<void>} waitFor Resolves when the script returns something truthy.
 * @property {() => Promise<void>} load
 * @property {(w: number, h: number) => Promise<void>} resize
 * @property {(cmd: string, params?: object) => Promise<PageValue>} cdp A DevTools protocol command.
 * @property {(value: string) => Promise<void>} key
 * @property {(modifier: string, value: string) => Promise<void>} keyChord
 * @property {typeof delay} wait
 */

const ASSET = /^\/(?:style\.css|[\w-]+\.js|vendor\/[\w-]+\.js)$/;
/** @type {Record<string, string>} */
const TYPES = { css: 'text/css', js: 'text/javascript' };
const DASHBOARD = new URL('../dashboard/', import.meta.url);

/** @param {{ address(): AddressInfo | string | null }} server */
export const portOf = (server) => {
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'the server listens on a port');
  return address.port;
};

const WINDOWS = process.platform === 'win32';
/** @param {string} name */
const onPath = (name) => spawnSync('sh', ['-c', `command -v ${name}`]).status === 0;

// The driver, browser and WebDriver vocabulary to use, or null when this machine has none.
// The browser tests do not run on Windows.
/** @returns {{ driver: string, name: string, options: string, cdp: string } | null} */
const target = () =>
  !WINDOWS && onPath('chromedriver') && (onPath('chromium') || onPath('google-chrome'))
    ? { driver: 'chromedriver', name: 'chrome', options: 'goog:chromeOptions', cdp: 'goog' }
    : null;

export const hasBrowser = () => target() !== null;

// Whether the process (or, on POSIX, the process group of a detached driver) still runs.
/** @param {number} pid */
export const isRunning = (pid) => {
  try {
    process.kill(WINDOWS ? pid : -pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Kills the process and its children: the whole process group on POSIX, the process tree through taskkill on Windows.
/** @param {number} pid */
export const killTree = (pid) => {
  if (WINDOWS) {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 10_000 });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
};

// ChromeDriver runs in its own process group (a process tree on Windows), so an interrupted test run (Ctrl-C, a CI cancel)
// would not reach it. Kill the drivers that are still open when this process exits or is signalled.
/** @type {Map<number, string>} */
const live = new Map();
const killLive = () => {
  for (const [pid, dir] of live) {
    killTree(pid);
    rmSync(dir, { recursive: true, force: true });
  }
};
process.on('exit', killLive);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    killLive();
    process.exit(128 + (signal === 'SIGINT' ? 2 : 15));
  });

// Ends ChromeDriver and the Chromium it started, and waits for them to exit, so Chromium removes its temporary profile
// (/tmp/org.chromium.Chromium.scoped_dir.*). The driver runs in its own process group, so the whole group is waited on and,
// when it does not leave within graceMs of /shutdown, killed (the process tree on Windows). The driver must have been spawned with detached: true. Every wait is bounded, so a stuck browser cannot hang the suite.
/**
 * @param {{ pid?: number }} driver
 * @param {number} port
 * @param {{ graceMs?: number, killMs?: number }} [options]
 */
export async function stopDriver(driver, port, { graceMs = 2000, killMs = 1000 } = {}) {
  const pid = driver.pid;
  if (pid === undefined) return;
  const alive = () => isRunning(pid);
  /** @param {number} ms */
  const untilGone = async (ms) => {
    for (const end = Date.now() + ms; alive() && Date.now() < end;) await delay(25);
    return !alive();
  };
  if (!alive()) return;
  await fetch(`http://127.0.0.1:${port}/shutdown`, { signal: AbortSignal.timeout(1000) }).catch(() => {});
  if (await untilGone(graceMs)) return;
  killTree(pid);
  await untilGone(killMs);
}

// Opens the real Dashboard page in headless Chromium against a stub server, or returns null (and skips the test) without a browser.
// state.runs is served as /api/views, state.files as /files/<run>/<name>, and state.respond(req) answers DELETE and POST requests.
/**
 * @param {{ skip: (reason: string) => void }} t
 * @param {PageState} state
 * @param {{ args?: string[], width?: number, height?: number }} [options]
 */
export async function openPage(t, state, { args = [], width = 1200, height = 700 } = {}) {
  if (WINDOWS) {
    t.skip('the browser tests are not supported on Windows');
    return null;
  }
  const browser = target();
  if (!browser) {
    // CI sets REQUIRE_BROWSER so that a runner without a browser fails instead of silently skipping these tests.
    if (process.env.REQUIRE_BROWSER) throw new Error('A browser and its driver are required (REQUIRE_BROWSER is set)');
    t.skip('A browser and its driver (ChromeDriver and Chromium) are required');
    return null;
  }
  /** @type {string[]} */
  const calls = [];
  /** @type {(string | string[] | undefined)[]} */
  const tokens = []; // the X-Factory-Token header of each write
  const served = Object.assign(state, { runs: state.runs ?? [], files: state.files ?? {} });
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    /**
     * @param {number} status
     * @param {string} type
     * @param {string | Buffer} body
     * @param {Record<string, string>} [headers]
     */
    const send = (status, type, body, headers = {}) => {
      res.writeHead(status, { 'content-type': type, ...headers });
      res.end(body);
    };
    if (req.method !== 'GET') {
      calls.push(`${req.method} ${req.url}`);
      tokens.push(req.headers['x-factory-token']);
      const answer = state.respond?.(req) ?? { status: 200, body: '' };
      return send(answer.status, 'text/plain', answer.body, answer.headers);
    }
    if (path === '/') return send(200, 'text/html', readFileSync(new URL('index.html', DASHBOARD)));
    if (ASSET.test(path))
      return send(200, TYPES[path.split('.').pop() ?? ''], readFileSync(new URL(path.slice(1), DASHBOARD)));
    if (/^\/api\/projects\/p\/runs\/[^/]+\/merge-checks$/.test(path))
      return send(200, 'text/plain', state.checks ?? 'GitHub checks: unavailable');
    // A read of the PR status of a Run (the Check again button): recorded in state.statusCalls, answered with state.statusReply.
    if (/^\/api\/projects\/p\/runs\/[^/]+\/pr-status$/.test(path)) {
      (state.statusCalls ??= []).push(req.url ?? '');
      state.statusReply?.();
      return send(200, 'application/json', JSON.stringify(state.statusBody ?? {}));
    }
    if (path === '/api/info')
      return send(
        200,
        'application/json',
        JSON.stringify({ project: state.project ?? 'test', version: state.version, token: 'test-token' }),
      );
    if (path === '/api/views' && state.failViews) return send(500, 'text/plain', 'down');
    if (path === '/api/views')
      return send(
        200,
        'application/json',
        JSON.stringify({
          projects: [
            { id: 'p', name: 'p', missing: false, runs: served.runs.map((run) => ({ ...run, projectId: 'p' })) },
          ],
        }),
      );
    if (path.startsWith('/files/p/')) {
      const text = served.files[decodeURIComponent(path.slice('/files/p/'.length))];
      return text === undefined ? send(404, 'text/plain', 'not found') : send(200, 'text/markdown', text);
    }
    send(404, 'text/plain', 'not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const portServer = createPortServer();
  await new Promise((resolve) => portServer.listen(0, '127.0.0.1', () => resolve(undefined)));
  const driverPort = portOf(portServer);
  await new Promise((resolve) => portServer.close(() => resolve(undefined)));
  // A private temp directory keeps this session's Chromium files apart. ChromeDriver and Chromium leave some small empty
  // directories in it even after a clean exit, so close() removes the whole directory after the processes are gone.
  const tmp = mkdtempSync(join(tmpdir(), 'tds-factory-browser-'));
  const driver = spawn(browser.driver, [`--port=${driverPort}`], {
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp },
  });
  if (driver.pid !== undefined) live.set(driver.pid, tmp);
  /**
   * @param {string} method
   * @param {string} path
   * @param {object} [body]
   * @param {number} [timeout]
   * @returns {Promise<PageValue>} The `value` of the WebDriver answer.
   */
  const request = async (method, path, body, timeout) => {
    const res = await fetch(`http://127.0.0.1:${driverPort}` + path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(timeout ? { signal: AbortSignal.timeout(timeout) } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    return typeof data === 'object' && data !== null && 'value' in data ? data.value : undefined;
  };
  /** @type {string | undefined} */
  let session;
  /** @type {Promise<void> | undefined} */
  let closing;
  /** @type {string[] | null} */
  let leftovers = null;
  const close = () =>
    (closing ??= (async () => {
      try {
        if (session) await request('DELETE', '/session/' + session, undefined, 5000).catch(() => {});
        await stopDriver(driver, driverPort);
        if (driver.pid !== undefined) live.delete(driver.pid);
        leftovers = (() => {
          try {
            return readdirSync(tmp);
          } catch {
            return [];
          }
        })();
      } finally {
        rmSync(tmp, { recursive: true, force: true });
        await new Promise((resolve) => {
          server.close(() => resolve(undefined));
          server.closeAllConnections();
        });
      }
    })());
  try {
    for (let i = 0; i < 50; i++) {
      try {
        await request('GET', '/status');
        break;
      } catch {
        await delay(100);
      }
    }
    session = (
      await request('POST', '/session', {
        capabilities: {
          alwaysMatch: {
            browserName: browser.name,
            [browser.options]: {
              args: [
                '--headless',
                '--no-sandbox',
                '--disable-dev-shm-usage',
                `--window-size=${width},${height}`,
                ...args,
              ],
            },
          },
        },
      })
    ).sessionId;
    const base = '/session/' + session;
    // Window sizing is clamped by Chromium (a 375px window can have a 500px viewport).
    // Set CSS viewport dimensions through browser emulation before responsive assertions.
    await request('POST', `${base}/${browser.cdp}/cdp/execute`, {
      cmd: 'Emulation.setDeviceMetricsOverride',
      params: { width, height, deviceScaleFactor: 1, mobile: false },
    });
    /**
     * @param {string} script
     * @param {unknown[]} [scriptArgs]
     */
    const execute = (script, scriptArgs = []) => request('POST', base + '/execute/sync', { script, args: scriptArgs });
    /** @type {Page} */
    const page = {
      driverPid: driver.pid,
      tmp,
      get leftovers() {
        return leftovers;
      },
      state: served,
      calls,
      tokens,
      execute,
      close,
      screenshot: () => request('GET', base + '/screenshot'),
      // Resolves when the script returns something truthy; fails with the script after five seconds.
      /** @param {string} script */
      async waitFor(script) {
        for (let i = 0; i < 50; i++) {
          if (await execute(script)) return;
          await delay(100);
        }
        throw new Error('Timed out waiting for: ' + script);
      },
      load: () => request('POST', base + '/url', { url: `http://127.0.0.1:${portOf(server)}/` }),
      /**
       * @param {number} w
       * @param {number} h
       */
      async resize(w, h) {
        await request('POST', `${base}/${browser.cdp}/cdp/execute`, {
          cmd: 'Emulation.setDeviceMetricsOverride',
          params: { width: w, height: h, deviceScaleFactor: 1, mobile: false },
        });
        assert.deepEqual(await execute('return { width: window.innerWidth, height: window.innerHeight }'), {
          width: w,
          height: h,
        });
      },
      // A DevTools protocol command, for example to emulate prefers-reduced-motion or forced-colors.
      /**
       * @param {string} cmd
       * @param {object} [params]
       */
      cdp: (cmd, params) => request('POST', `${base}/${browser.cdp}/cdp/execute`, { cmd, params }),
      /** @param {string} value */
      key: (value) =>
        request('POST', base + '/actions', {
          actions: [
            {
              type: 'key',
              id: 'keyboard',
              actions: [
                { type: 'keyDown', value },
                { type: 'keyUp', value },
              ],
            },
          ],
        }),
      /**
       * @param {string} modifier
       * @param {string} value
       */
      keyChord: (modifier, value) =>
        request('POST', base + '/actions', {
          actions: [
            {
              type: 'key',
              id: 'keyboard',
              actions: [
                { type: 'keyDown', value: modifier },
                { type: 'keyDown', value },
                { type: 'keyUp', value },
                { type: 'keyUp', value: modifier },
              ],
            },
          ],
        }),
      wait: delay,
    };
    await page.load();
    assert.deepEqual(
      await execute('return { width: window.innerWidth, height: window.innerHeight }'),
      { width, height },
      'browser CSS viewport matches requested dimensions',
    );
    await page.waitFor("return !!document.querySelector('#board section, .welcome')");
    return page;
  } catch (err) {
    await close().catch(() => {});
    if (err instanceof Error) Object.assign(err, { tmp, driverPid: driver.pid, leftovers });
    throw err;
  }
}

/** @param {Partial<RunStub>} [over] */
export const run = (over) => ({
  id: 'r',
  title: 'Run',
  column: 'build',
  status: 'running',
  updated: new Date().toISOString(),
  files: [],
  links: [],
  ...over,
});
