import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli as runCli } from './cli-runner.js';
import { repo } from './git-repo.js';
import { metricsOf, fromJson } from './run-view.js';

/** @import { Run } from '../src/run-record.js' */

/**
 * @param {string} cwd
 * @param {...string} args
 */
const run = (cwd, ...args) => runCli(cwd, 'run', ...args);
/**
 * @param {string} cwd
 * @param {...string} args
 */
const command = async (cwd, ...args) => {
  const r = await run(cwd, ...args);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
/**
 * @param {string} cwd
 * @param {string} id
 */
const file = (cwd, id) => join(cwd, '.factory', 'runs', id, 'run.json');
/**
 * @param {string} cwd
 * @param {string} id
 * @returns {Run}
 */
const read = (cwd, id) => JSON.parse(readFileSync(file(cwd, id), 'utf8'));
/** @param {string} cwd */
const start = async (cwd, title = 'Cause') =>
  await command(cwd, 'start', '--data', JSON.stringify({ title, agent: 'codex', commands: 'true', conventions: [] }));
// A Run in Check with its only Ticket done.
/**
 * @param {string} cwd
 * @param {string} [title]
 */
async function inCheck(cwd, title) {
  const id = await start(cwd, title);
  await command(
    cwd,
    'update',
    '--id',
    id,
    '--data',
    JSON.stringify({ spec_link: 's.md', tickets: ['1'], tickets_total: 1, tickets_done: 1 }),
  );
  await command(cwd, 'transition', '--id', id, '--to', 'build');
  await command(cwd, 'transition', '--id', id, '--to', 'check');
  return id;
}

test('rework takes causes from a fixed list, stores them with the Rework and run stats counts them', async () => {
  const cwd = repo();
  const id = await inCheck(cwd);
  await command(cwd, 'rework', '--id', id, '--cause', 'stale-doc', '--cause', 'test-gap');
  const record = read(cwd, id);
  assert.equal(record.check_loops, 1);
  assert.deepEqual(
    metricsOf(record).rework_causes?.map((r) => r.causes),
    [['stale-doc', 'test-gap']],
  );
  const out = await command(cwd, 'stats', '--id', id);
  assert.match(out, /Reworks: 1\n {2}Rework causes: stale-doc 1, test-gap 1\n/);
});

test('an unknown cause is refused with the valid ones and the Run is left unchanged', async () => {
  const cwd = repo();
  const id = await inCheck(cwd);
  const before = readFileSync(file(cwd, id), 'utf8');
  const result = await run(cwd, 'rework', '--id', id, '--cause', 'sloppy');
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /unknown cause "sloppy" \(use stale-doc, test-gap, spec-gap, security, bug, size, other\)/,
  );
  assert.equal(readFileSync(file(cwd, id), 'utf8'), before);
});

test('a Rework without a cause, and an older record, count as unknown; no Rework says none', async () => {
  const cwd = repo();
  const plain = await inCheck(cwd, 'Plain');
  await command(cwd, 'rework', '--id', plain);
  assert.match(await command(cwd, 'stats', '--id', plain), /Rework causes: unknown 1\n/);
  const none = await start(cwd, 'None');
  assert.match(await command(cwd, 'stats', '--id', none), /Rework causes: none\n/);
  const old = await inCheck(cwd, 'Old');
  const record = read(cwd, old);
  writeFileSync(file(cwd, old), JSON.stringify({ ...record, check_loops: 2 }));
  assert.match(await command(cwd, 'stats', '--id', old), /Rework causes: unknown 2\n/);
});

test('run stats --all adds the causes of all Runs and names the unknown ones', async () => {
  const cwd = repo();
  const a = await inCheck(cwd, 'A');
  const b = await inCheck(cwd, 'B');
  await command(cwd, 'rework', '--id', a, '--cause', 'stale-doc');
  await command(cwd, 'rework', '--id', b);
  const total = (await command(cwd, 'stats', '--all')).split('Total observed')[1];
  assert.match(total, /Rework causes: stale-doc 1, unknown 1\n/);
});

test('a damaged stored cause list shows only the known causes', async () => {
  const cwd = repo();
  const id = await inCheck(cwd);
  await command(cwd, 'rework', '--id', id, '--cause', 'bug');
  const record = read(cwd, id);
  metricsOf(record).rework_causes?.push(fromJson({ attempt: 9, causes: ['evil\u001b[31m', 'size', 7, null], at: 'x' }));
  record.check_loops = 2;
  writeFileSync(file(cwd, id), JSON.stringify(record));
  const out = await command(cwd, 'stats', '--id', id);
  assert.match(out, /Rework causes: bug 1, size 1\n/);
  assert.doesNotMatch(out, /\u001b/);
});

test('a repeated cause counts once, and one unknown cause among valid ones refuses the whole Rework', async () => {
  const cwd = repo();
  const id = await inCheck(cwd);
  const mixed = await run(cwd, 'rework', '--id', id, '--cause', 'bug', '--cause', 'sloppy');
  assert.notEqual(mixed.status, 0);
  assert.equal(read(cwd, id).check_loops, 0);
  await command(cwd, 'rework', '--id', id, '--cause', 'bug', '--cause', 'bug');
  assert.deepEqual(
    metricsOf(read(cwd, id)).rework_causes?.map((r) => r.causes),
    [['bug']],
  );
  assert.match(await command(cwd, 'stats', '--id', id), /Rework causes: bug 1\n/);
});
