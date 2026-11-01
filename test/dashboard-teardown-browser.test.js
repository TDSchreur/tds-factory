import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { openPage } from './browser.js';

// Chromium's per-session scratch directories (about 2 MB each); the ones that piled up in /tmp.
const isScoped = (name) => name.startsWith('org.chromium.Chromium.scoped_dir.');
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('closing a page leaves no browser process and no scoped directory', async (t) => {
  const page = await openPage(t, { runs: [] });
  if (!page) return;
  assert.ok(alive(-page.driverPid), 'the driver group runs while the page is open');
  await page.close();
  await page.close();
  assert.equal(alive(-page.driverPid), false, 'no ChromeDriver or Chromium process remains');
  assert.deepEqual(page.leftovers.filter(isScoped), [], 'Chromium removed its scoped directories itself');
  assert.equal(existsSync(page.tmp), false, 'the private temp directory is removed');
});

test('a failed browser start leaves no browser process and no scoped directory', async (t) => {
  // Chromium cannot use a user data directory below /dev/null, so the session is not created.
  const err = await openPage(t, { runs: [] }, { args: ['--user-data-dir=/dev/null/x'] }).then(
    (page) => (page === null ? undefined : null),
    (e) => e,
  );
  if (err === undefined) return;
  assert.ok(err, 'the start failed');
  assert.match(err.message, /session not created/);
  assert.equal(alive(-err.driverPid), false, 'no ChromeDriver or Chromium process remains');
  assert.deepEqual(err.leftovers.filter(isScoped), []);
  assert.equal(existsSync(err.tmp), false, 'the private temp directory is removed');
});
