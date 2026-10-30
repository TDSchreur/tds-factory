import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { hasBrowser, openPage, stopDriver } from './browser.js';

// Chromium's per-session scratch directories (about 2 MB each); the ones that piled up in /tmp.
const isScoped = (name) => name.startsWith('org.chromium.Chromium.scoped_dir.');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

// A driver that ignores /shutdown and SIGTERM, with a child in its group, like a stuck ChromeDriver with its Chromium.
const STUCK = `
  process.on('SIGTERM', () => {});
  require('node:child_process').spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' });
  setInterval(() => {}, 1000);
`;

test('teardown kills a driver that ignores shutdown, with its children, within the bounds', async () => {
  const driver = spawn(process.execPath, ['-e', STUCK], { stdio: 'ignore', detached: true });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const started = Date.now();
  await stopDriver(driver, await freePort(), { graceMs: 300, killMs: 1000 });
  assert.ok(Date.now() - started < 3000, 'teardown stayed bounded');
  assert.equal(alive(-driver.pid), false, 'the driver process group is gone');
});

test('teardown is a no-op for a driver that already exited', async () => {
  const driver = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', detached: true });
  await new Promise((resolve) => driver.once('exit', resolve));
  await stopDriver(driver, await freePort(), { graceMs: 300, killMs: 300 });
});

test('closing a page leaves no browser process and no scoped directory', async (t) => {
  if (!hasBrowser()) return t.skip('Chromium and ChromeDriver are required');
  const page = await openPage(t, { runs: [] });
  assert.ok(alive(-page.driverPid), 'the driver group runs while the page is open');
  await page.close();
  await page.close();
  assert.equal(alive(-page.driverPid), false, 'no ChromeDriver or Chromium process remains');
  assert.deepEqual(page.leftovers.filter(isScoped), [], 'Chromium removed its scoped directories itself');
  assert.equal(existsSync(page.tmp), false, 'the private temp directory is removed');
});

test('a failed browser start leaves no browser process and no scoped directory', async (t) => {
  if (!hasBrowser()) return t.skip('Chromium and ChromeDriver are required');
  const err = await openPage(t, { runs: [] }, { args: ['--user-data-dir=/proc/nonexistent/x'] }).then(() => null, (e) => e);
  assert.ok(err, 'the start failed');
  assert.equal(alive(-err.driverPid), false, 'no ChromeDriver or Chromium process remains');
  assert.deepEqual(err.leftovers.filter(isScoped), []);
});
