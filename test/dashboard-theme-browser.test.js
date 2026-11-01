import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './browser.js';

const choose = (value) => `var s = document.getElementById('theme'); s.value = '${value}'; s.dispatchEvent(new Event('change', { bubbles: true }));`;
const theme = "return [document.documentElement.dataset.theme, document.getElementById('theme').value, localStorage.getItem('dashboard-theme')]";

test('theme selection defaults to system and persists choices across reloads', async (t) => {
  const page = await openPage(t, {});
  if (!page) return;
  try {
    assert.deepEqual(await page.execute(theme), ['system', 'system', null]);
    await page.execute(choose('dark'));
    await page.waitFor("return localStorage.getItem('dashboard-theme') === 'dark'");
    assert.deepEqual(await page.execute(theme), ['dark', 'dark', 'dark']);
    await page.load();
    await page.waitFor("return !!document.getElementById('theme')");
    assert.deepEqual(await page.execute(theme), ['dark', 'dark', 'dark']);
    await page.execute(choose('light'));
    await page.waitFor("return document.documentElement.dataset.theme === 'light'");
  } finally { await page.close(); }
});

test('an invalid saved theme falls back to system, and blocked storage still lets the user choose', async (t) => {
  const page = await openPage(t, {});
  if (!page) return;
  try {
    await page.execute("localStorage.setItem('dashboard-theme', 'purple')");
    await page.load();
    await page.waitFor("return !!document.getElementById('theme')");
    assert.deepEqual(await page.execute("return [document.documentElement.dataset.theme, document.getElementById('theme').value]"), ['system', 'system']);
    await page.execute('Storage.prototype.setItem = function () { throw new Error("blocked"); };' + choose('dark'));
    await page.waitFor("return document.documentElement.dataset.theme === 'dark'");
    assert.equal(await page.execute("return document.getElementById('theme').value"), 'dark');
  } finally { await page.close(); }
});

test('rendered theme follows the system preference and manual overrides', async (t) => {
  for (const dark of [false, true]) {
    const page = await openPage(t, {}, { args: dark ? ['--force-dark-mode'] : [] });
    if (!page) return;
    try {
      const colors = await page.execute(`var out = { systemDark: matchMedia('(prefers-color-scheme: dark)').matches };
        ['system', 'light', 'dark'].forEach(function (theme) { document.documentElement.dataset.theme = theme; out[theme] = getComputedStyle(document.body).backgroundColor; });
        return out;`);
      assert.equal(colors.systemDark, dark);
      assert.equal(colors.light, 'rgb(250, 250, 250)');
      assert.equal(colors.dark, 'rgb(31, 31, 31)');
      assert.equal(colors.system, dark ? colors.dark : colors.light);
    } finally { await page.close(); }
  }
});
