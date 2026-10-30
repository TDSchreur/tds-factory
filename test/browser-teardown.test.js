import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { stopDriver } from './browser.js';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

// A driver that ignores /shutdown and SIGTERM and prints its child's pid, like a stuck ChromeDriver with its Chromium.
const STUCK = `
  process.on('SIGTERM', () => {});
  const child = require('node:child_process').spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' });
  console.log(child.pid);
  setInterval(() => {}, 1000);
`;

test('teardown kills a driver that ignores shutdown, with its children, within the bounds', async (t) => {
  const driver = spawn(process.execPath, ['-e', STUCK], { stdio: ['ignore', 'pipe', 'ignore'], detached: true });
  t.after(() => { try { process.kill(-driver.pid, 'SIGKILL'); } catch { /* already gone */ } });
  const child = Number(await new Promise((resolve) => driver.stdout.once('data', resolve)));
  assert.ok(alive(child), 'the child runs before teardown');
  const started = Date.now();
  await stopDriver(driver, await freePort(), { graceMs: 300, killMs: 1000 });
  assert.ok(Date.now() - started < 3000, 'teardown stayed bounded');
  assert.equal(alive(-driver.pid), false, 'the driver process group is gone');
  // The killed child is reaped by init asynchronously (macOS shows it as a zombie for a moment), so allow a short wait.
  for (let i = 0; i < 40 && alive(child); i++) await delay(50);
  assert.equal(alive(child), false, 'the child is gone');
});

test('teardown is a no-op for a driver that already exited', async () => {
  const driver = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', detached: true });
  await new Promise((resolve) => driver.once('exit', resolve));
  await delay(50);
  await stopDriver(driver, await freePort(), { graceMs: 300, killMs: 300 });
});
