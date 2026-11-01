import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, git } from './git-repo.js';

const cli = resolve('bin/tds-factory.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });
const command = (cwd, ...args) => {
  const r = run(cwd, ...args);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const file = (cwd, id) => join(cwd, '.factory', 'runs', id, 'run.json');
const read = (cwd, id) => JSON.parse(readFileSync(file(cwd, id), 'utf8'));
const start = (cwd) =>
  command(
    cwd,
    'start',
    '--data',
    JSON.stringify({ title: 'Metrics', agent: 'codex', commands: 'true', conventions: [] }),
  );
const update = (cwd, id, data) => command(cwd, 'update', '--id', id, '--data', JSON.stringify(data));
const move = (cwd, id, to) => command(cwd, 'transition', '--id', id, '--to', to);

test('named transitions preserve visits, verdicts, and the first Check outcome across Rework', () => {
  const cwd = repo(),
    id = start(cwd);
  let record = read(cwd, id);
  assert.equal(record.metrics.visits[0].stage, 'define');
  assert.ok(Date.parse(record.metrics.visits[0].started));
  const before = JSON.stringify(record);
  assert.notEqual(run(cwd, 'transition', '--id', id, '--to', 'check').status, 0);
  assert.equal(JSON.stringify(read(cwd, id)), before);
  assert.notEqual(run(cwd, 'update', '--id', id, '--data', JSON.stringify({ metrics: {} })).status, 0);
  update(cwd, id, { spec_link: 'spec.md', tickets: ['1'], tickets_total: 1, tickets_done: 1 });
  move(cwd, id, 'build');
  move(cwd, id, 'check');
  command(cwd, 'verdict', '--id', id, '--axis', 'standards', '--value', 'fail');
  command(cwd, 'verdict', '--id', id, '--axis', 'standards', '--value', 'pass');
  command(cwd, 'rework', '--id', id);
  record = read(cwd, id);
  assert.deepEqual(
    record.metrics.visits.map((v) => v.stage),
    ['define', 'build', 'check', 'build'],
  );
  assert.ok(record.metrics.visits.slice(0, 3).every((v) => Date.parse(v.ended) >= Date.parse(v.started)));
  assert.equal(record.metrics.visits[3].ended, undefined);
  assert.deepEqual(
    record.metrics.verdicts.map((v) => [v.axis, v.value, v.attempt]),
    [
      ['standards', 'fail', 1],
      ['standards', 'pass', 1],
    ],
  );
  assert.equal(record.metrics.first_check, 'unclean');
  assert.equal(record.check_loops, 1);
  assert.equal(record.standards, undefined);
  move(cwd, id, 'check');
  command(cwd, 'verify', '--id', id);
  for (const [axis, value] of [
    ['standards', 'pass'],
    ['spec', 'pass'],
    ['security', 'pass'],
    ['infrastructure', 'skipped'],
  ])
    command(cwd, 'verdict', '--id', id, '--axis', axis, '--value', value);
  move(cwd, id, 'finish');
  assert.equal(read(cwd, id).metrics.first_check, 'unclean');
  update(cwd, id, { status: 'abandoned' });
  assert.ok(Date.parse(read(cwd, id).metrics.visits.at(-1).ended));
});

test('stats report observed durations, clean outcomes and missing data without changing records', () => {
  const cwd = repo(),
    id = start(cwd),
    record = read(cwd, id);
  record.metrics.visits = [
    { stage: 'define', started: '2026-01-01T00:00:00.000Z', ended: '2026-01-01T00:01:00.000Z' },
    { stage: 'build', started: '2026-01-01T00:01:00.000Z', ended: '2026-01-01T00:03:00.000Z' },
    { stage: 'build', started: '2026-01-01T00:03:00.000Z', ended: '2026-01-01T00:04:00.000Z' },
  ];
  record.metrics.first_check = 'clean';
  writeFileSync(file(cwd, id), JSON.stringify(record));
  const legacyDir = join(cwd, '.factory', 'runs', 'legacy');
  mkdirSync(legacyDir);
  writeFileSync(join(legacyDir, 'run.json'), JSON.stringify({ title: 'Old', check_loops: 2 }));
  const brokenDir = join(cwd, '.factory', 'runs', 'broken');
  mkdirSync(brokenDir);
  writeFileSync(join(brokenDir, 'run.json'), '{');
  const before = readFileSync(file(cwd, id), 'utf8');
  const one = command(cwd, 'stats', '--id', id);
  assert.match(one, /Define: 1m 0s/);
  assert.match(one, /Build: 3m 0s/);
  assert.match(one, /Check: no data/);
  assert.match(one, /First-pass clean rate: 100% \(1\/1\)/);
  assert.match(one, /Tokens: not tracked/);
  assert.match(one, /Cost: not tracked/);
  const all = command(cwd, 'stats', '--all');
  assert.match(all, /legacy/);
  assert.match(all, /broken: unreadable \(no data\)/);
  assert.match(all, /missing or unreadable data/);
  assert.match(all, /Reworks: 2/);
  assert.match(all, /First-pass clean rate: 100% \(1\/1\)/);
  assert.equal(readFileSync(file(cwd, id), 'utf8'), before);
  assert.notEqual(run(cwd, 'stats', '--id', 'missing').status, 0);
  assert.notEqual(run(cwd, 'stats', '--id', id, '--all').status, 0);
  assert.notEqual(run(cwd, 'stats').status, 0);
});

test('first Check rate distinguishes clean and Accepted nonclean outcomes and excludes unresolved Runs', () => {
  const cwd = repo();
  const prepare = () => {
    const id = start(cwd);
    update(cwd, id, { spec_link: 'spec.md', tickets: ['1'], tickets_total: 1, tickets_done: 1 });
    move(cwd, id, 'build');
    move(cwd, id, 'check');
    return id;
  };
  const clean = prepare();
  command(cwd, 'verify', '--id', clean);
  for (const [axis, value] of [
    ['standards', 'pass'],
    ['spec', 'pass'],
    ['security', 'pass'],
    ['infrastructure', 'skipped'],
  ])
    command(cwd, 'verdict', '--id', clean, '--axis', axis, '--value', value);
  move(cwd, clean, 'finish');
  update(cwd, clean, { pr: 'https://example.test/pr/1' });
  command(cwd, 'complete', '--id', clean);
  assert.ok(read(cwd, clean).metrics.visits.at(-1).ended);
  const accepted = prepare();
  command(
    cwd,
    'accept',
    '--id',
    accepted,
    '--data',
    JSON.stringify({ findings: 'missing reviews', decision: 'continue' }),
  );
  move(cwd, accepted, 'finish');
  prepare();
  const all = command(cwd, 'stats', '--all');
  assert.match(all, /First-pass clean rate: 50% \(1\/2\)/);
  assert.equal(read(cwd, accepted).metrics.first_check, 'unclean');
});

test('Dashboard view shares the stats summary and tolerates missing or malformed metrics', async () => {
  const { interpretRun } = await import('../src/dashboard.js');
  const entry = (record) => ({ id: 'x', record, files: [] });
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
  assert.equal(measured.metrics.stages.check, '2m 0s');
  assert.equal(measured.metrics.firstPass, '0% (0/1)');
  assert.equal(measured.metrics.reworks, '1');
  assert.equal(measured.metrics.tokens, 'not tracked');
  for (const metrics of [
    undefined,
    { version: 1, visits: 'bad' },
    { version: 1, visits: [{ stage: { toString: 'bad' }, started: 'bad' }], verdicts: [] },
  ]) {
    const old = interpretRun(entry({ title: 'Old', metrics }));
    assert.equal(old.title, 'Old');
    assert.equal(old.metrics.stages.check, 'no data');
    assert.equal(old.metrics.firstPass, 'no data');
    assert.equal(old.metrics.reworks, 'no data');
  }
});

test('legacy updates leave history unknown and linked worktrees can read stats without a Run worktree', () => {
  const cwd = repo(),
    id = start(cwd),
    record = read(cwd, id);
  delete record.metrics;
  writeFileSync(file(cwd, id), JSON.stringify(record));
  update(cwd, id, { spec_link: 'spec.md', tickets: ['1'], tickets_total: 1, tickets_done: 1 });
  move(cwd, id, 'build');
  move(cwd, id, 'check');
  command(cwd, 'verdict', '--id', id, '--axis', 'security', '--value', 'fail');
  command(cwd, 'rework', '--id', id);
  assert.equal(read(cwd, id).metrics, undefined);
  const stats = command(read(cwd, id).worktree, 'stats', '--id', id);
  assert.match(stats, /Build: no data/);
  assert.match(stats, /Reworks: 1/);
  assert.match(stats, /First-pass clean rate: no data/);
  git(cwd, 'worktree', 'remove', record.worktree);
  assert.match(command(cwd, 'stats', '--id', id), /Reworks: 1/);
});

test('open Stage time includes waiting and is labeled ongoing', () => {
  const cwd = repo(),
    id = start(cwd);
  update(cwd, id, { status: 'waiting', waiting_reason: 'answer' });
  const record = read(cwd, id);
  assert.equal(record.metrics.visits.length, 1);
  assert.equal(record.metrics.visits[0].ended, undefined);
  assert.match(command(cwd, 'stats', '--id', id), /Define: \d+s \(ongoing\)/);
});
