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
