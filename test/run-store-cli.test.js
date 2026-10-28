import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('bin/tds-factory.js');
function run(cwd, ...args) { return spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' }); }
test('Run record command creates and safely updates a record', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'factory-run-'));
  const start = run(cwd, 'start', '--data', JSON.stringify({ title: 'Example', agent: 'codex', commands: 'npm test', conventions: ['AGENTS.md'] }));
  assert.equal(start.status, 0, start.stderr);
  const id = start.stdout.trim();
  const file = join(cwd, '.factory', 'runs', id, 'run.json');
  const created = JSON.parse(readFileSync(file));
  assert.equal(created.stage, 'define');
  const update = run(cwd, 'update', '--id', id, '--data', JSON.stringify({ status: 'waiting', waiting_reason: 'answer', activity: 'asking' }));
  assert.equal(update.status, 0, update.stderr);
  const waiting = JSON.parse(readFileSync(file));
  assert.equal(waiting.waiting_on_human, true);
  assert.equal(waiting.created, created.created);
  const bad = run(cwd, 'update', '--id', id, '--data', JSON.stringify({ stage: 'wrong' }));
  assert.notEqual(bad.status, 0);
  assert.deepEqual(JSON.parse(readFileSync(file)), waiting);
});

test('Dashboard interprets incomplete and unreadable Run records', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { startDashboard } = await import('../src/dashboard.js');
  const cwd = mkdtempSync(join(tmpdir(), 'factory-view-'));
  for (const id of ['old', 'broken']) mkdirSync(join(cwd, '.factory', 'runs', id), { recursive: true });
  writeFileSync(join(cwd, '.factory', 'runs', 'old', 'run.json'), JSON.stringify({ stage: 'unknown', status: 'waiting', extra: 1 }));
  writeFileSync(join(cwd, '.factory', 'runs', 'broken', 'run.json'), '{');
  const dashboard = await startDashboard({ projectDir: cwd, port: 0 });
  try {
    const records = await (await fetch(dashboard.url + '/api/views')).json();
    const old = records.find((r) => r.id === 'old');
    assert.equal(old.column, 'define');
    assert.equal(old.waiting, true);
    assert.equal(records.find((r) => r.id === 'broken').unreadable, true);
  } finally { await dashboard.close(); }
});

test('updates preserve unknown fields on an older record and clear waiting on resume', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const cwd = mkdtempSync(join(tmpdir(), 'factory-old-'));
  const dir = join(cwd, '.factory', 'runs', 'old');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'run.json');
  writeFileSync(file, JSON.stringify({ created: 'original', status: 'waiting', waiting_reason: 'answer', waiting_on_human: true, future: { value: 42 } }));
  const result = run(cwd, 'update', '--id', 'old', '--data', JSON.stringify({ status: 'running', activity: 'continuing' }));
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(readFileSync(file));
  assert.deepEqual(record.future, { value: 42 });
  assert.equal(record.created, 'original');
  assert.equal(record.waiting_on_human, false);
  assert.equal(record.waiting_reason, '');
});

test('incomplete waiting records allow unrelated updates', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const cwd = mkdtempSync(join(tmpdir(), 'factory-incomplete-'));
  const dir = join(cwd, '.factory', 'runs', 'old'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), '{"status":"waiting"}');
  const result = run(cwd, 'update', '--id', 'old', '--data', '{"activity":"continuing"}');
  assert.equal(result.status, 0, result.stderr);
});

test('new Runs always start with zero Check loops', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'factory-initial-'));
  const result = run(cwd, 'start', '--data', JSON.stringify({ title: 'Example', agent: 'codex', commands: 'npm test', conventions: [], check_loops: 2 }));
  assert.notEqual(result.status, 0);
});

test('Run commands reject linked storage outside the project', async () => {
  const { mkdirSync, symlinkSync, writeFileSync } = await import('node:fs');
  const cwd = mkdtempSync(join(tmpdir(), 'factory-link-'));
  const outside = mkdtempSync(join(tmpdir(), 'factory-outside-'));
  mkdirSync(join(cwd, '.factory')); symlinkSync(outside, join(cwd, '.factory', 'runs'));
  mkdirSync(join(outside, 'old')); const file = join(outside, 'old', 'run.json'); writeFileSync(file, '{"status":"running"}');
  assert.notEqual(run(cwd, 'update', '--id', 'old', '--data', '{"activity":"changed"}').status, 0);
  assert.notEqual(run(cwd, 'start', '--data', '{"title":"Test","agent":"codex","commands":"test","conventions":[]}').status, 0);
  assert.equal(readFileSync(file, 'utf8'), '{"status":"running"}');
});

test('a failed replacement leaves the existing Run record intact', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const cwd = mkdtempSync(join(tmpdir(), 'factory-failed-'));
  const dir = join(cwd, '.factory', 'runs', 'old'); mkdirSync(dir, { recursive: true });
  const file = join(dir, 'run.json'); writeFileSync(file, '{"status":"running"}');
  const preload = join(cwd, 'fail.cjs'); writeFileSync(preload, "require('node:fs').renameSync = () => { throw new Error('replacement failed'); };\n");
  const result = spawnSync(process.execPath, ['--require', preload, cli, 'run', 'update', '--id', 'old', '--data', '{"activity":"changed"}'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(file, 'utf8'), '{"status":"running"}');
});
