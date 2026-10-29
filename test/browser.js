import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const ASSET = /^\/(?:style\.css|[\w-]+\.js|vendor\/[\w-]+\.js)$/;
const TYPES = { css: 'text/css', js: 'text/javascript' };
const DASHBOARD = new URL('../dashboard/', import.meta.url);

export const hasBrowser = () => spawnSync('sh', ['-c', 'command -v chromedriver && (command -v chromium || command -v google-chrome)']).status === 0;

// Opens the real Dashboard page in headless Chromium against a stub server, or returns null (and skips the test) without a browser.
// state.runs is served as /api/views, state.files as /files/<run>/<name>, and state.respond(req) answers DELETE and POST requests.
export async function openPage(t, state, { args = [], width = 1200 } = {}) {
  if (!hasBrowser()) {
    // CI sets REQUIRE_BROWSER so that a runner without a browser fails instead of silently skipping these tests.
    if (process.env.REQUIRE_BROWSER) throw new Error('Chromium and ChromeDriver are required (REQUIRE_BROWSER is set)');
    t.skip('Chromium and ChromeDriver are required');
    return null;
  }
  const calls = [];
  state.runs ??= [];
  state.files ??= {};
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type }); res.end(body); };
    if (req.method !== 'GET') {
      calls.push(`${req.method} ${req.url}`);
      const answer = state.respond?.(req) ?? { status: 200, body: '' };
      return send(answer.status, 'text/plain', answer.body);
    }
    if (path === '/') return send(200, 'text/html', readFileSync(new URL('index.html', DASHBOARD)));
    if (ASSET.test(path)) return send(200, TYPES[path.split('.').pop()], readFileSync(new URL(path.slice(1), DASHBOARD)));
    if (/^\/api\/runs\/[^/]+\/merge-checks$/.test(path)) return send(200, 'text/plain', state.checks ?? 'GitHub checks: unavailable');
    if (path === '/api/info') return send(200, 'application/json', JSON.stringify({ project: state.project ?? 'test' }));
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
  const driver = spawn('chromedriver', [`--port=${driverPort}`], { stdio: 'ignore' });
  const request = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${driverPort}` + path, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    return data.value;
  };
  let session;
  const close = async () => {
    if (session) await request('DELETE', '/session/' + session).catch(() => {});
    driver.kill();
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  };
  try {
    for (let i = 0; i < 50; i++) { try { await request('GET', '/status'); break; } catch { await delay(100); } }
    session = (await request('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless', '--no-sandbox', '--disable-dev-shm-usage', `--window-size=${width},700`, ...args] } } } })).sessionId;
    const base = '/session/' + session;
    const execute = (script) => request('POST', base + '/execute/sync', { script, args: [] });
    const page = {
      state, calls, execute, close,
      // Resolves when the script returns something truthy; fails with the script after five seconds.
      async waitFor(script) {
        for (let i = 0; i < 50; i++) { if (await execute(script)) return; await delay(100); }
        throw new Error('Timed out waiting for: ' + script);
      },
      load: () => request('POST', base + '/url', { url: `http://127.0.0.1:${server.address().port}/` }),
      key: (value) => request('POST', base + '/actions', { actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value }, { type: 'keyUp', value }] }] }),
      wait: delay,
    };
    await page.load();
    await page.waitFor("return !!document.querySelector('#board section')");
    return page;
  } catch (err) {
    await close();
    throw err;
  }
}

export const run = (over) => ({ id: 'r', title: 'Run', column: 'build', status: 'running', updated: new Date().toISOString(), files: [], links: [], ...over });
