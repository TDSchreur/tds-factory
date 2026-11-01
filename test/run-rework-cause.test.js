import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo } from './git-repo.js';

const cli = resolve('bin/tds-factory.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });
const command = (cwd, ...args) => {
  const r = run(cwd, ...args);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const file = (cwd, id) => join(cwd, '.factory', 'runs', id, 'run.json');
const read = (cwd, id) => JSON.parse(readFileSync(file(cwd, id), 'utf8'));
const start = (cwd, title = 'Cause') =>
  command(cwd, 'start', '--data', JSON.stringify({ title, agent: 'codex', commands: 'true', conventions: [] }));
// A Run in Check with its only Ticket done.
function inCheck(cwd, title) {
  const id = start(cwd, title);
  command(
    cwd,
    'update',
    '--id',
    id,
    '--data',
    JSON.stringify({ spec_link: 's.md', tickets: ['1'], tickets_total: 1, tickets_done: 1 }),
  );
  command(cwd, 'transition', '--id', id, '--to', 'build');
  command(cwd, 'transition', '--id', id, '--to', 'check');
  return id;
}

test('rework takes causes from a fixed list, stores them with the Rework and run stats counts them', () => {
  const cwd = repo();
  const id = inCheck(cwd);
  command(cwd, 'rework', '--id', id, '--cause', 'stale-doc', '--cause', 'test-gap');
  const record = read(cwd, id);
  assert.equal(record.check_loops, 1);
  assert.deepEqual(
    record.metrics.rework_causes.map((r) => r.causes),
    [['stale-doc', 'test-gap']],
  );
  const out = command(cwd, 'stats', '--id', id);
  assert.match(out, /Reworks: 1\n {2}Rework causes: stale-doc 1, test-gap 1\n/);
});

test('an unknown cause is refused with the valid ones and the Run is left unchanged', () => {
  const cwd = repo();
  const id = inCheck(cwd);
  const before = readFileSync(file(cwd, id), 'utf8');
  const result = run(cwd, 'rework', '--id', id, '--cause', 'sloppy');
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /unknown cause "sloppy" \(use stale-doc, test-gap, spec-gap, security, bug, size, other\)/,
  );
  assert.equal(readFileSync(file(cwd, id), 'utf8'), before);
});

test('a Rework without a cause, and an older record, count as unknown; no Rework says none', () => {
  const cwd = repo();
  const plain = inCheck(cwd, 'Plain');
  command(cwd, 'rework', '--id', plain);
  assert.match(command(cwd, 'stats', '--id', plain), /Rework causes: unknown 1\n/);
  const none = start(cwd, 'None');
  assert.match(command(cwd, 'stats', '--id', none), /Rework causes: none\n/);
  const old = inCheck(cwd, 'Old');
  const record = read(cwd, old);
  writeFileSync(file(cwd, old), JSON.stringify({ ...record, check_loops: 2 }));
  assert.match(command(cwd, 'stats', '--id', old), /Rework causes: unknown 2\n/);
});

test('run stats --all adds the causes of all Runs and names the unknown ones', () => {
  const cwd = repo();
  const a = inCheck(cwd, 'A');
  const b = inCheck(cwd, 'B');
  command(cwd, 'rework', '--id', a, '--cause', 'stale-doc');
  command(cwd, 'rework', '--id', b);
  const total = command(cwd, 'stats', '--all').split('Total observed')[1];
  assert.match(total, /Rework causes: stale-doc 1, unknown 1\n/);
});

test('a damaged stored cause list shows only the known causes', () => {
  const cwd = repo();
  const id = inCheck(cwd);
  command(cwd, 'rework', '--id', id, '--cause', 'bug');
  const record = read(cwd, id);
  record.metrics.rework_causes.push({ attempt: 9, causes: ['evil\u001b[31m', 'size', 7, null], at: 'x' });
  record.check_loops = 2;
  writeFileSync(file(cwd, id), JSON.stringify(record));
  const out = command(cwd, 'stats', '--id', id);
  assert.match(out, /Rework causes: bug 1, size 1\n/);
  assert.doesNotMatch(out, /\u001b/);
});

test('a repeated cause counts once, and one unknown cause among valid ones refuses the whole Rework', () => {
  const cwd = repo();
  const id = inCheck(cwd);
  const mixed = run(cwd, 'rework', '--id', id, '--cause', 'bug', '--cause', 'sloppy');
  assert.notEqual(mixed.status, 0);
  assert.equal(read(cwd, id).check_loops, 0);
  command(cwd, 'rework', '--id', id, '--cause', 'bug', '--cause', 'bug');
  assert.deepEqual(
    read(cwd, id).metrics.rework_causes.map((r) => r.causes),
    [['bug']],
  );
  assert.match(command(cwd, 'stats', '--id', id), /Rework causes: bug 1\n/);
});
