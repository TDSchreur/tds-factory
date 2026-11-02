import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const ASSET = /^\/(?:style\.css|[\w-]+\.js|vendor\/[\w-]+\.js)$/;
const TYPES = { css: 'text/css', js: 'text/javascript' };
const DASHBOARD = new URL('../dashboard/', import.meta.url);

const WINDOWS = process.platform === 'win32';
const onPath = (name) =>
  spawnSync(WINDOWS ? 'where' : 'sh', WINDOWS ? [name] : ['-c', `command -v ${name}`]).status === 0;

// On Windows Edge is preferred (it ships with Windows, only msedgedriver has to be installed); Chrome is the fallback.
// Neither browser is on PATH there, so look in the install folders (CHROME_BIN overrides the Chrome lookup).
const windowsFile = (...parts) =>
  ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA']
    .map((base) => process.env[base] && join(process.env[base], ...parts))
    .find((file) => file && existsSync(file));

// The driver, browser and WebDriver vocabulary to use, or null when this machine has none.
const target = () => {
  if (WINDOWS) {
    // The browser tests are slow under Windows for now; they run there only when asked for.
    if (!process.env.TDS_WINDOWS_BROWSER && !process.env.REQUIRE_BROWSER) return null;
    const edge = windowsFile('Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (onPath('msedgedriver') && edge)
      return { driver: 'msedgedriver', binary: edge, name: 'MicrosoftEdge', options: 'ms:edgeOptions', cdp: 'ms' };
    const chrome =
      (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN) && process.env.CHROME_BIN) ||
      windowsFile('Google', 'Chrome', 'Application', 'chrome.exe') ||
      windowsFile('Chromium', 'Application', 'chrome.exe');
    if (onPath('chromedriver') && chrome)
      return { driver: 'chromedriver', binary: chrome, name: 'chrome', options: 'goog:chromeOptions', cdp: 'goog' };
    return null;
  }
  return onPath('chromedriver') && (onPath('chromium') || onPath('google-chrome'))
    ? { driver: 'chromedriver', name: 'chrome', options: 'goog:chromeOptions', cdp: 'goog' }
    : null;
};

export const hasBrowser = () => target() !== null;

// Whether the process (or, on POSIX, the process group of a detached driver) still runs.
export const isRunning = (pid) => {
  try {
    process.kill(WINDOWS ? pid : -pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Kills the process and its children: the whole process group on POSIX, the process tree through taskkill on Windows.
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
export async function stopDriver(driver, port, { graceMs = 2000, killMs = 1000 } = {}) {
  const alive = () => isRunning(driver.pid);
  const untilGone = async (ms) => {
    for (const end = Date.now() + ms; alive() && Date.now() < end;) await delay(25);
    return !alive();
  };
  if (!alive()) return;
  await fetch(`http://127.0.0.1:${port}/shutdown`, { signal: AbortSignal.timeout(1000) }).catch(() => {});
  if (await untilGone(graceMs)) return;
  killTree(driver.pid);
  await untilGone(killMs);
}

// Opens the real Dashboard page in headless Chromium against a stub server, or returns null (and skips the test) without a browser.
// state.runs is served as /api/views, state.files as /files/<run>/<name>, and state.respond(req) answers DELETE and POST requests.
export async function openPage(t, state, { args = [], width = 1200, height = 700 } = {}) {
  const browser = target();
  if (!browser) {
    // CI sets REQUIRE_BROWSER so that a runner without a browser fails instead of silently skipping these tests.
    if (process.env.REQUIRE_BROWSER) throw new Error('A browser and its driver are required (REQUIRE_BROWSER is set)');
    t.skip('A browser and its driver (ChromeDriver, or msedgedriver on Windows) are required');
    return null;
  }
  const calls = [];
  const tokens = []; // the X-Factory-Token header of each write
  state.runs ??= [];
  state.files ??= {};
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
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
      return send(200, TYPES[path.split('.').pop()], readFileSync(new URL(path.slice(1), DASHBOARD)));
    if (/^\/api\/runs\/[^/]+\/merge-checks$/.test(path))
      return send(200, 'text/plain', state.checks ?? 'GitHub checks: unavailable');
    // A read of the PR status of a Run (the Check again button): recorded in state.statusCalls, answered with state.statusReply.
    if (/^\/api\/runs\/[^/]+\/pr-status$/.test(path)) {
      (state.statusCalls ??= []).push(req.url);
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
    if (path === '/api/views') return send(200, 'application/json', JSON.stringify(state.runs));
    if (path.startsWith('/files/')) {
      const text = state.files[decodeURIComponent(path.slice('/files/'.length))];
      return text === undefined ? send(404, 'text/plain', 'not found') : send(200, 'text/markdown', text);
    }
    send(404, 'text/plain', 'not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const portServer = createPortServer();
  await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve));
  const driverPort = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  // A private temp directory keeps this session's Chromium files apart. ChromeDriver and Chromium leave some small empty
  // directories in it even after a clean exit, so close() removes the whole directory after the processes are gone.
  const tmp = mkdtempSync(join(tmpdir(), 'tds-factory-browser-'));
  const driver = spawn(browser.driver, [`--port=${driverPort}`], {
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp },
  });
  live.set(driver.pid, tmp);
  const request = async (method, path, body, timeout) => {
    const res = await fetch(`http://127.0.0.1:${driverPort}` + path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(timeout ? { signal: AbortSignal.timeout(timeout) } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    return data.value;
  };
  let session;
  let closing;
  const page = { driverPid: driver.pid, tmp, leftovers: null };
  const close = () =>
    (closing ??= (async () => {
      try {
        if (session) await request('DELETE', '/session/' + session, undefined, 5000).catch(() => {});
        await stopDriver(driver, driverPort);
        live.delete(driver.pid);
        page.leftovers = (() => {
          try {
            return readdirSync(tmp);
          } catch {
            return [];
          }
        })();
      } finally {
        rmSync(tmp, { recursive: true, force: true });
        await new Promise((resolve) => {
          server.close(resolve);
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
              ...(browser.binary ? { binary: browser.binary } : {}),
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
    const execute = (script, scriptArgs = []) => request('POST', base + '/execute/sync', { script, args: scriptArgs });
    Object.assign(page, {
      state,
      calls,
      tokens,
      execute,
      close,
      screenshot: () => request('GET', base + '/screenshot'),
      // Resolves when the script returns something truthy; fails with the script after five seconds.
      async waitFor(script) {
        for (let i = 0; i < 50; i++) {
          if (await execute(script)) return;
          await delay(100);
        }
        throw new Error('Timed out waiting for: ' + script);
      },
      load: () => request('POST', base + '/url', { url: `http://127.0.0.1:${server.address().port}/` }),
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
      cdp: (cmd, params) => request('POST', `${base}/${browser.cdp}/cdp/execute`, { cmd, params }),
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
    });
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
    err.tmp = tmp;
    err.driverPid = page.driverPid;
    err.leftovers = page.leftovers;
    throw err;
  }
}

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
