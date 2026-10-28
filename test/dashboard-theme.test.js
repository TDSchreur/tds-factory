import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
function load(saved, storageFails = false) {
  const root = { dataset: {} };
  const select = { value: '', handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } };
  const values = new Map(saved ? [['dashboard-theme', saved]] : []);
  const localStorage = { getItem(k) { if (storageFails) throw Error('blocked'); return values.get(k); }, setItem(k, v) { if (storageFails) throw Error('blocked'); values.set(k, v); } };
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const script = scripts.find((s) => s.includes('dashboard-theme'));
  assert.ok(script, 'theme control script exists');
  runInNewContext(script, { document: { documentElement: root, getElementById: () => select, addEventListener: (event, fn) => fn() }, localStorage });
  return { root, select, values };
}

test('theme selection defaults to system and persists choices across reloads', () => {
  const first = load();
  assert.equal(first.select.value, 'system');
  first.select.value = 'dark'; first.select.handlers.change();
  assert.equal(first.root.dataset.theme, 'dark');
  assert.equal(first.values.get('dashboard-theme'), 'dark');
  const reloaded = load(first.values.get('dashboard-theme'));
  assert.equal(reloaded.select.value, 'dark');
  assert.equal(reloaded.root.dataset.theme, 'dark');
  reloaded.select.value = 'light'; reloaded.select.handlers.change();
  assert.equal(reloaded.root.dataset.theme, 'light');
  reloaded.select.value = 'system'; reloaded.select.handlers.change();
  assert.equal(reloaded.root.dataset.theme, 'system');
});

test('invalid or blocked browser storage falls back to system and remains usable', () => {
  assert.equal(load('bogus').select.value, 'system');
  const blocked = load(null, true);
  assert.equal(blocked.select.value, 'system');
  blocked.select.value = 'dark'; blocked.select.handlers.change();
  assert.equal(blocked.root.dataset.theme, 'dark');
});

test('rendered theme follows system preference and manual overrides', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const browser = spawnSync('sh', ['-c', 'command -v chromium || command -v chromium-browser || command -v google-chrome'], { encoding: 'utf8' }).stdout.trim();
  if (!browser) { t.skip('Chromium is unavailable'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-theme-'));
  const probe = `<script>window.addEventListener('load', function () {
    var result = { systemDark: matchMedia('(prefers-color-scheme: dark)').matches };
    ['system', 'light', 'dark'].forEach(function (theme) {
      document.documentElement.dataset.theme = theme;
      result[theme] = getComputedStyle(document.body).backgroundColor;
    });
    var out = document.createElement('pre'); out.id = 'theme-result'; out.textContent = JSON.stringify(result); document.body.appendChild(out);
  });</script>`;
  const file = join(dir, 'page.html');
  writeFileSync(file, html.replace('</body>', probe + '</body>'));
  try {
    for (const dark of [false, true]) {
      const args = ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--user-data-dir=${join(dir, dark ? 'dark' : 'light')}`];
      if (dark) args.push('--force-dark-mode');
      const result = spawnSync(browser, [...args, '--dump-dom', `file://${file}`], { encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, 0, result.stderr);
      const output = result.stdout.match(/<pre id="theme-result">([^<]+)<\/pre>/);
      assert.ok(output, 'browser reported computed colors');
      const colors = JSON.parse(output[1]);
      assert.equal(colors.systemDark, dark);
      assert.equal(colors.light, 'rgb(246, 247, 249)');
      assert.equal(colors.dark, 'rgb(20, 23, 26)');
      assert.equal(colors.system, dark ? colors.dark : colors.light);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
