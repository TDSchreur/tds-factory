import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cli as runCli } from './cli-runner.js';
import { repo, git } from './git-repo.js';
import { metricsOf, defined, entryOf } from './run-view.js';

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
const start = async (cwd) =>
  await command(
    cwd,
    'start',
    '--data',
    JSON.stringify({ title: 'Metrics', agent: 'codex', commands: 'true', conventions: [] }),
  );
/**
 * @param {string} cwd
 * @param {string} id
 * @param {Record<string, unknown>} data
 */
const update = async (cwd, id, data) => await command(cwd, 'update', '--id', id, '--data', JSON.stringify(data));
/**
 * @param {string} cwd
 * @param {string} id
 * @param {string} to
 */
const move = async (cwd, id, to) => await command(cwd, 'transition', '--id', id, '--to', to);

test('named transitions preserve visits, verdicts, and the first Check outcome across Rework', async () => {
  const cwd = repo(),
    id = await start(cwd);
  let record = read(cwd, id);
  assert.equal(metricsOf(record).visits[0].stage, 'define');
  assert.ok(Date.parse(metricsOf(record).visits[0].started));
  const before = JSON.stringify(record);
  assert.notEqual((await run(cwd, 'transition', '--id', id, '--to', 'check')).status, 0);
  assert.equal(JSON.stringify(read(cwd, id)), before);
  assert.notEqual((await run(cwd, 'update', '--id', id, '--data', JSON.stringify({ metrics: {} }))).status, 0);
  await update(cwd, id, { spec_link: 'spec.md', tickets: ['1'], tickets_total: 1, tickets_done: 1 });
  await move(cwd, id, 'build');
  await move(cwd, id, 'check');
  await command(cwd, 'verdict', '--id', id, '--axis', 'standards', '--value', 'fail');
  await command(cwd, 'verdict', '--id', id, '--axis', 'standards', '--value', 'pass');
  await command(cwd, 'rework', '--id', id);
  record = read(cwd, id);
  assert.deepEqual(
    metricsOf(record).visits.map((v) => v.stage),
    ['define', 'build', 'check', 'build'],
  );
  assert.ok(
    metricsOf(record)
      .visits.slice(0, 3)
      .every((v) => Date.parse(defined(v.ended, 'a left Stage has an end')) >= Date.parse(v.started)),
  );
  assert.equal(metricsOf(record).visits[3].ended, undefined);
  assert.deepEqual(
    metricsOf(record).verdicts.map((v) => [v.axis, v.value, v.attempt]),
    [
      ['standards', 'fail', 1],
      ['standards', 'pass', 1],
    ],
  );
  assert.equal(metricsOf(record).first_check, 'unclean');
  assert.equal(record.check_loops, 1);
  assert.equal(record.standards, undefined);
  await move(cwd, id, 'check');
  await command(cwd, 'verify', '--id', id);
  for (const [axis, value] of [
    ['standards', 'pass'],
    ['spec', 'pass'],
    ['security', 'pass'],
    ['infrastructure', 'skipped'],
  ])
    await command(cwd, 'verdict', '--id', id, '--axis', axis, '--value', value);
  await move(cwd, id, 'finish');
  assert.equal(metricsOf(read(cwd, id)).first_check, 'unclean');
  await update(cwd, id, { status: 'abandoned' });
  assert.ok(Date.parse(defined(metricsOf(read(cwd, id)).visits.at(-1)?.ended, 'the last visit has ended')));
});

test('stats report observed durations, clean outcomes and missing data without changing records', async () => {
  const cwd = repo(),
    id = await start(cwd),
    record = read(cwd, id);
  metricsOf(record).visits = [
    { stage: 'define', started: '2026-01-01T00:00:00.000Z', ended: '2026-01-01T00:01:00.000Z' },
    { stage: 'build', started: '2026-01-01T00:01:00.000Z', ended: '2026-01-01T00:03:00.000Z' },
    { stage: 'build', started: '2026-01-01T00:03:00.000Z', ended: '2026-01-01T00:04:00.000Z' },
  ];
  metricsOf(record).first_check = 'clean';
  writeFileSync(file(cwd, id), JSON.stringify(record));
  const legacyDir = join(cwd, '.factory', 'runs', 'legacy');
  mkdirSync(legacyDir);
  writeFileSync(join(legacyDir, 'run.json'), JSON.stringify({ title: 'Old', check_loops: 2 }));
  const brokenDir = join(cwd, '.factory', 'runs', 'broken');
  mkdirSync(brokenDir);
  writeFileSync(join(brokenDir, 'run.json'), '{');
  const before = readFileSync(file(cwd, id), 'utf8');
  const one = await command(cwd, 'stats', '--id', id);
  assert.match(one, /Define: 1m 0s/);
  assert.match(one, /Build: 3m 0s/);
  assert.match(one, /Check: no data/);
  assert.match(one, /First-pass clean rate: 100% \(1\/1\)/);
  assert.match(one, /Tokens: not tracked/);
  assert.match(one, /Cost: not tracked/);
  const all = await command(cwd, 'stats', '--all');
  assert.match(all, /legacy/);
  assert.match(all, /broken: unreadable \(no data\)/);
  assert.match(all, /missing or unreadable data/);
  assert.match(all, /Reworks: 2/);
  assert.match(all, /First-pass clean rate: 100% \(1\/1\)/);
  assert.equal(readFileSync(file(cwd, id), 'utf8'), before);
  assert.notEqual((await run(cwd, 'stats', '--id', 'missing')).status, 0);
  assert.notEqual((await run(cwd, 'stats', '--id', id, '--all')).status, 0);
  assert.notEqual((await run(cwd, 'stats')).status, 0);
});

test('first Check rate distinguishes clean and Accepted nonclean outcomes and excludes unresolved Runs', async () => {
  const cwd = repo();
  const prepare = async () => {
    const id = await start(cwd);
    await update(cwd, id, { spec_link: 'spec.md', tickets: ['1'], tickets_total: 1, tickets_done: 1 });
    await move(cwd, id, 'build');
    await move(cwd, id, 'check');
    return id;
  };
  const clean = await prepare();
  await command(cwd, 'verify', '--id', clean);
  for (const [axis, value] of [
    ['standards', 'pass'],
    ['spec', 'pass'],
    ['security', 'pass'],
    ['infrastructure', 'skipped'],
  ])
    await command(cwd, 'verdict', '--id', clean, '--axis', axis, '--value', value);
  await move(cwd, clean, 'finish');
  await update(cwd, clean, { pr: 'https://example.test/pr/1' });
  await command(cwd, 'complete', '--id', clean);
  assert.ok(metricsOf(read(cwd, clean)).visits.at(-1)?.ended);
  const accepted = await prepare();
  await command(
    cwd,
    'accept',
    '--id',
    accepted,
    '--data',
    JSON.stringify({ findings: 'missing reviews', decision: 'continue' }),
  );
  await move(cwd, accepted, 'finish');
  await prepare();
  const all = await command(cwd, 'stats', '--all');
  assert.match(all, /First-pass clean rate: 50% \(1\/2\)/);
  assert.equal(metricsOf(read(cwd, accepted)).first_check, 'unclean');
});

test('Dashboard view shares the stats summary and tolerates missing or malformed metrics', async () => {
  const { interpretRun } = await import('../src/dashboard.js');
  /** @param {Record<string, unknown>} record */
  const entry = (record) => entryOf('x', record);
  const measured = interpretRun(
    entry({
      check_loops: 1,
      metrics: {
        version: 1,
        visits: [{ stage: 'check', started: '2026-01-01T00:00:00Z', ended: '2026-01-01T00:02:00Z' }],
        verdicts: [],
        first_check: 'unclean',
      },
    }),
  );
  assert.equal(metricsOf(measured).stages.check, '2m 0s');
  assert.equal(metricsOf(measured).firstPass, '0% (0/1)');
  assert.equal(metricsOf(measured).reworks, '1');
  assert.equal(metricsOf(measured).tokens, 'not tracked');
  for (const metrics of [
    undefined,
    { version: 1, visits: 'bad' },
    { version: 1, visits: [{ stage: { toString: 'bad' }, started: 'bad' }], verdicts: [] },
  ]) {
    const old = interpretRun(entry({ title: 'Old', metrics }));
    assert.equal(old.title, 'Old');
    assert.equal(metricsOf(old).stages.check, 'no data');
    assert.equal(metricsOf(old).firstPass, 'no data');
    assert.equal(metricsOf(old).reworks, 'no data');
  }
});

test('legacy updates leave history unknown and linked worktrees can read stats without a Run worktree', async () => {
  const cwd = repo(),
    id = await start(cwd),
    record = read(cwd, id);
  delete record.metrics;
  writeFileSync(file(cwd, id), JSON.stringify(record));
  await update(cwd, id, { spec_link: 'spec.md', tickets: ['1'], tickets_total: 1, tickets_done: 1 });
  await move(cwd, id, 'build');
  await move(cwd, id, 'check');
  await command(cwd, 'verdict', '--id', id, '--axis', 'security', '--value', 'fail');
  await command(cwd, 'rework', '--id', id);
  assert.equal(read(cwd, id).metrics, undefined);
  const stats = await command(read(cwd, id).worktree, 'stats', '--id', id);
  assert.match(stats, /Build: no data/);
  assert.match(stats, /Reworks: 1/);
  assert.match(stats, /First-pass clean rate: no data/);
  git(cwd, 'worktree', 'remove', record.worktree);
  assert.match(await command(cwd, 'stats', '--id', id), /Reworks: 1/);
});

test('open Stage time includes waiting and is labeled ongoing', async () => {
  const cwd = repo(),
    id = await start(cwd);
  await update(cwd, id, { status: 'waiting', waiting_reason: 'answer' });
  const record = read(cwd, id);
  assert.equal(metricsOf(record).visits.length, 1);
  assert.equal(metricsOf(record).visits[0].ended, undefined);
  assert.match(await command(cwd, 'stats', '--id', id), /Define: \d+s \(ongoing\)/);
});
