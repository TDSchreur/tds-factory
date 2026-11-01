import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openRunStore, loopCap } from '../src/run-store.js';
import { readEvents } from '../src/run-events.js';
import { repo } from './git-repo.js';

const start = { title: 'Example', agent: 'claude', commands: 'true', conventions: [] };
const file = (main, id) => join(main, '.factory', 'runs', id, 'run.json');
const read = (main, id) => JSON.parse(readFileSync(file(main, id), 'utf8'));
const setRecord = (main, id, change) => writeFileSync(file(main, id), JSON.stringify({ ...read(main, id), ...change }));

// A Run in Check that waits on the user at its loop limit.
function atLimit(over = {}) {
  const main = repo();
  const store = openRunStore(main);
  const id = store.start(start);
  setRecord(main, id, {
    stage: 'check',
    status: 'waiting',
    waiting_on_human: true,
    waiting_reason: 'Blocking findings remain',
    check_loops: 4,
    ...over,
  });
  return { main, store, id };
}
const refuses = (store, id, pattern, data) => assert.throws(() => store.grantLoop(id, data), pattern);

test('the grant adds one loop, raises the cap and releases the Run', () => {
  const { main, store, id } = atLimit();
  assert.equal(loopCap(read(main, id)), 4);
  store.grantLoop(id);
  const record = read(main, id);
  assert.equal(record.extra_loops, 1);
  assert.equal(loopCap(record), 5);
  assert.equal(record.status, 'running');
  assert.equal(record.waiting_on_human, false);
  assert.equal(record.waiting_reason, '');
  assert.equal(record.check_loops, 4);
  assert.match(record.activity, /granted an extra Check loop/);
});

test('the grant is in the Event log with the new limit', () => {
  const { main, store, id } = atLimit();
  store.grantLoop(id);
  const events = readEvents(join(main, '.factory', 'runs', id)).events;
  const grant = events.find((e) => e.type === 'extra-loop');
  assert.deepEqual([grant.granted, grant.limit], [1, 5]);
  assert.ok(events.some((e) => e.type === 'released'));
});

test('a Rework is allowed after the grant, once, and the grant has no ceiling', () => {
  const { main, store, id } = atLimit();
  assert.throws(() => {
    setRecord(main, id, { status: 'running' });
    store.rework(id);
  }, /limit of 4 is reached/);
  setRecord(main, id, { status: 'waiting', waiting_on_human: true });
  store.grantLoop(id);
  store.rework(id);
  assert.equal(read(main, id).check_loops, 5);
  assert.equal(read(main, id).stage, 'build');
  // Back at the raised limit in Check: grant again and again.
  for (let i = 2; i <= 6; i++) {
    setRecord(main, id, { stage: 'check', status: 'waiting', waiting_on_human: true, check_loops: 4 + i - 1 });
    store.grantLoop(id);
    assert.equal(read(main, id).extra_loops, i);
    assert.equal(loopCap(read(main, id)), 4 + i);
  }
});

test('a lower project cap is raised from where it is', () => {
  const { main, store, id } = atLimit({
    project_config: { models: {}, max_check_loops: 1, labels: {} },
    check_loops: 1,
  });
  assert.equal(loopCap(read(main, id)), 1);
  store.grantLoop(id);
  assert.equal(loopCap(read(main, id)), 2);
});

test('the grant is refused outside its one case', () => {
  const notCheck = atLimit({ stage: 'build' });
  refuses(notCheck.store, notCheck.id, /only a Run in Check/);
  const running = atLimit({ status: 'running', waiting_on_human: false });
  refuses(running.store, running.id, /waits on the user/);
  const paused = atLimit({ status: 'interrupted', waiting_on_human: false, status_reason: 'signal' });
  refuses(paused.store, paused.id, /waits on the user/);
  const below = atLimit({ check_loops: 3 });
  refuses(below.store, below.id, /limit of 4 is not reached/);
  const stale = atLimit();
  refuses(stale.store, stale.id, /changed since it was shown/, { updated: '2000-01-01T00:00:00.000Z' });
  assert.equal(read(stale.main, stale.id).extra_loops, undefined);
  const fresh = atLimit();
  fresh.store.grantLoop(fresh.id, { updated: read(fresh.main, fresh.id).updated });
  assert.equal(read(fresh.main, fresh.id).extra_loops, 1);
});

test('the loop limit cannot be raised any other way', () => {
  const { main, store, id } = atLimit({ status: 'running', waiting_on_human: false });
  for (const data of [{ extra_loops: 1 }, { check_loops: 0 }])
    assert.throws(() => store.update(id, data), /can only change through a Run transition/);
  assert.equal(read(main, id).extra_loops, undefined);
  const cli = resolve('bin/tds-factory.js');
  for (const command of ['extra-loop', 'grant', 'grant-loop', 'loop']) {
    const out = spawnSync(process.execPath, [cli, 'run', command, '--id', id], { cwd: main, encoding: 'utf8' });
    assert.notEqual(out.status, 0, command);
  }
  assert.equal(read(main, id).extra_loops, undefined);
});

test('an old record without the field has no extra loops and loads unchanged', () => {
  const { main, id } = atLimit();
  assert.equal(read(main, id).extra_loops, undefined);
  assert.equal(loopCap(read(main, id)), 4);
  assert.equal(loopCap({ extra_loops: 'x', project_config: { max_check_loops: 2 } }), 2);
  assert.equal(loopCap({ extra_loops: -3 }), 4);
  assert.equal(loopCap(undefined), 4);
});
