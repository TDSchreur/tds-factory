import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

test('dialog Escape cancels and refresh preserves keyboard focus', async (t) => {
  if (spawnSync('sh', ['-c', 'command -v chromedriver && command -v chromium']).status !== 0) return t.skip('Chromium and ChromeDriver are required');
  const html = readFileSync(new URL('../dashboard.html', import.meta.url));
  let mutations = 0;
  const runs = [{ id: 'r', title: 'Example', column: 'done', status: 'done', updated: new Date().toISOString(), files: [], links: [], pr: 'https://github.com/a/b/pull/1', prState: 'open' }];
  const server = createServer((req, res) => {
    if (req.method === 'POST' || req.method === 'DELETE') mutations++;
    if (req.url === '/') return res.end(html);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/api/info' ? { project: 'test' } : runs));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const portServer = createPortServer();
  await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve));
  const driverPort = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  const driver = spawn('chromedriver', [`--port=${driverPort}`], { stdio: 'ignore' });
  let session;
  const request = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${driverPort}` + path, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    return data.value;
  };
  try {
    for (let i = 0; i < 50; i++) { try { await request('GET', '/status'); break; } catch { await delay(100); } }
    session = (await request('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless', '--no-sandbox', '--disable-dev-shm-usage'] } } } })).sessionId;
    const base = '/session/' + session;
    const execute = (script) => request('POST', base + '/execute/sync', { script, args: [] });
    await request('POST', base + '/url', { url: `http://127.0.0.1:${server.address().port}/` });
    for (let i = 0; i < 50; i++) {
      if (await execute("return !!document.querySelector('[aria-expanded]')")) break;
      await delay(100);
    }
    await execute(`document.querySelector('[aria-expanded]').click(); document.querySelector('[aria-label^="Squash and merge"]').focus(); document.activeElement.click();`);
    assert.equal(await execute("return document.querySelector('dialog').open && document.activeElement.textContent === 'Cancel'"), true);
    await request('POST', base + '/actions', { actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE00C' }, { type: 'keyUp', value: '\uE00C' }] }] });
    await delay(200);
    assert.equal(await execute("return !document.querySelector('dialog').open && document.activeElement.textContent === 'Merge'"), true);
    await delay(2300);
    assert.equal(await execute("return document.activeElement.textContent === 'Merge'"), true);
    assert.equal(mutations, 0);
  } finally {
    if (session) await request('DELETE', '/session/' + session).catch(() => {});
    driver.kill();
    await new Promise((resolve) => server.close(resolve));
  }
});
