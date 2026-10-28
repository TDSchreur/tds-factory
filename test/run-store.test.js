import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRunStore } from '../src/run-store.js';

const project = () => mkdtempSync(join(tmpdir(), 'run-store-'));
const seed = (cwd, id, files) => {
  const dir = join(cwd, '.factory', 'runs', id);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
};
const start = { title: 'Example', agent: 'codex', commands: 'npm test', conventions: [] };

test('start and update go through the store and list returns the raw record', async () => {
  const cwd = project();
  const store = openRunStore(cwd);
  const id = store.start(start);
  store.update(id, { status: 'waiting', waiting_reason: 'answer' });
  const [run] = await store.list();
  assert.equal(run.id, id);
  assert.equal(run.unreadable, false);
  assert.equal(run.record.waiting_on_human, true);
});

test('list flags broken records, tolerates a missing store and orders summaries by Stage', async () => {
  const cwd = project();
  assert.deepEqual(await openRunStore(cwd).list(), []);
  seed(cwd, 'broken', { 'run.json': '{' });
  seed(cwd, 'good', { 'run.json': '{"status":"running"}', 'finish.md': 'x', 'check-10.md': 'x', 'check-2.md': 'x', 'define.md': 'x' });
  const runs = await openRunStore(cwd).list();
  assert.equal(runs.find((r) => r.id === 'broken').unreadable, true);
  assert.deepEqual(runs.find((r) => r.id === 'good').files, ['define.md', 'check-2.md', 'check-10.md', 'finish.md']);
});

test('readFile serves only Markdown inside a Run folder', async () => {
  const cwd = project();
  seed(cwd, 'a', { 'run.json': '{}', 'define.md': '# hi' });
  const store = openRunStore(cwd);
  assert.equal(await store.readFile('a/define.md'), '# hi');
  for (const bad of ['a/run.json', 'a/../a/define.md', '../x.md', 'a', 'a/b/c.md']) assert.equal(await store.readFile(bad), null);
});

test('remove deletes only terminal Runs with a readable record', () => {
  const cwd = project();
  seed(cwd, 'done', { 'run.json': '{"status":"done"}' });
  seed(cwd, 'running', { 'run.json': '{"status":"running"}' });
  seed(cwd, 'broken', { 'run.json': '{' });
  const store = openRunStore(cwd);
  assert.equal(store.remove('done'), 'deleted');
  assert.equal(existsSync(join(cwd, '.factory', 'runs', 'done')), false);
  assert.equal(store.remove('running'), 'not-allowed');
  assert.equal(store.remove('broken'), 'not-allowed');
  assert.equal(store.remove('missing'), 'not-found');
  assert.equal(store.remove('..'), 'invalid');
});

test('remove refuses linked storage and a Run whose update lock is held', () => {
  const cwd = project();
  const outside = project();
  mkdirSync(join(cwd, '.factory'));
  symlinkSync(outside, join(cwd, '.factory', 'runs'));
  mkdirSync(join(outside, 'x'));
  writeFileSync(join(outside, 'x', 'run.json'), '{"status":"done"}');
  assert.equal(openRunStore(cwd).remove('x'), 'not-allowed');
  assert.ok(existsSync(join(outside, 'x')));

  const locked = project();
  seed(locked, 'y', { 'run.json': '{"status":"done"}' });
  const lock = join(locked, '.factory', 'runs', '.lock-' + createHash('sha256').update('y').digest('hex'));
  writeFileSync(lock, 'held');
  const store = openRunStore(locked);
  assert.equal(store.remove('y'), 'not-allowed');
  rmSync(lock);
  assert.equal(store.remove('y'), 'deleted');
});
