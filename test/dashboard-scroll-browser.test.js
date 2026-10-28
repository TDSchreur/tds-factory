import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createPortServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { startDashboard } from '../src/dashboard.js';

test('a refresh of the open Run keeps the scroll position', async (t) => {
  if (spawnSync('sh', ['-c', 'command -v chromedriver && command -v chromium']).status !== 0) return t.skip('Chromium and ChromeDriver are required');
  const tmp = mkdtempSync(join(tmpdir(), 'dash-scroll-'));
  const dir = join(tmp, '.factory', 'runs', 'r1');
  mkdirSync(dir, { recursive: true });
  const record = (n) => writeFileSync(join(dir, 'run.json'), JSON.stringify({ title: 'Long run', stage: 'build', status: 'running', updated: new Date(Date.now() + n * 1000).toISOString() }));
  record(0); // a current date keeps the Run out of the older Runs fold
  writeFileSync(join(dir, 'define.md'), '# Long\n\n' + Array.from({ length: 150 }, (_, i) => `- finding ${i}`).join('\n'));
  const dash = await startDashboard({ projectDir: tmp, port: 0 });
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
    session = (await request('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--window-size=1200,700'] } } } })).sessionId;
    const base = '/session/' + session;
    const execute = (script) => request('POST', base + '/execute/sync', { script, args: [] });
    await request('POST', base + '/url', { url: `http://127.0.0.1:${dash.port}/` });
    for (let i = 0; i < 50; i++) { if (await execute("return !!document.querySelector('.card')")) break; await delay(100); }
    await execute("document.querySelector('.card').click()");
    for (let i = 0; i < 50; i++) { if (await execute("return document.querySelectorAll('#detail li').length > 100")) break; await delay(100); }
    await execute('window.scrollTo(0, 800)');
    for (let n = 1; n <= 3; n++) { record(n); await delay(2300); } // each write changes `updated`, so the open Run refreshes
    assert.equal(await execute('return Math.round(window.scrollY)'), 800);
  } finally {
    if (session) await request('DELETE', '/session/' + session).catch(() => {});
    driver.kill();
    await dash.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});
