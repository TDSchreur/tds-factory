import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { git, repo } from './git-repo.js';

const cli = resolve('bin/tds-factory.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });
const json = (value) => JSON.stringify(value);
const file = (cwd, id) => join(cwd, '.factory', 'runs', id, 'run.json');
const read = (cwd, id) => JSON.parse(readFileSync(file(cwd, id), 'utf8'));
const startRun = (cwd) => {
  const result = run(cwd, 'start', '--data', json({ title: 'Example', agent: 'codex', commands: 'npm test', conventions: [] }));
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const update = (cwd, id, data) => run(cwd, 'update', '--id', id, '--data', json(data));

test('run update rejects fields that only a transition may change, and leaves the record unchanged', () => {
  const cwd = repo();
  const id = startRun(cwd);
  const before = read(cwd, id);
  for (const data of [{ stage: 'build' }, { check_loops: 1 }, { standards: 'pass' }, { spec: 'pass' }, { security: 'pass' }, { infrastructure: 'skipped' }, { status: 'done' }, { worktree: '/elsewhere' }, { base_sha: 'abc' }]) {
    const result = update(cwd, id, { ...data, activity: 'sneaky' });
    assert.notEqual(result.status, 0, json(data));
    assert.deepEqual(read(cwd, id), before, json(data));
  }
});

test('run update still takes activity, links, counters, waiting and abandoned', () => {
  const cwd = repo();
  const id = startRun(cwd);
  assert.equal(update(cwd, id, { activity: 'working', spec_link: 'docs/specs/x.md', tickets: ['1'], tickets_total: 1, tickets_done: 1 }).status, 0);
  assert.equal(update(cwd, id, { status: 'waiting', waiting_reason: 'answer' }).status, 0);
  assert.equal(update(cwd, id, { status: 'running' }).status, 0);
  assert.equal(update(cwd, id, { status: 'abandoned' }).status, 0);
  assert.equal(read(cwd, id).status, 'abandoned');
});

test('a finished Run cannot change status through update, but still takes notes', () => {
  const cwd = repo();
  const id = startRun(cwd);
  for (const status of ['done', 'abandoned']) {
    writeFileSync(file(cwd, id), json({ ...read(cwd, id), status, waiting_on_human: false, waiting_reason: '' }));
    for (const next of ['running', 'waiting', 'abandoned']) assert.notEqual(update(cwd, id, { status: next, waiting_reason: next === 'waiting' ? 'x' : '' }).status, 0, `${status} to ${next}`);
    assert.equal(read(cwd, id).status, status);
    assert.equal(update(cwd, id, { activity: 'PR merged' }).status, 0);
  }
});

test('start records the base commit of the fetched origin default branch', () => {
  const cwd = repo();
  git(cwd, 'commit', '-q', '--allow-empty', '-m', 'second');
  const id = startRun(cwd);
  assert.equal(read(cwd, id).base_sha, git(cwd, 'rev-parse', 'main'));
});

test('an old-shaped record without the new fields still takes allowed updates', () => {
  const cwd = repo();
  const dir = join(cwd, '.factory', 'runs', 'old');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), json({ stage: 'build', status: 'running', title: 'Old' }));
  assert.equal(update(cwd, 'old', { activity: 'still here' }).status, 0);
  assert.equal(read(cwd, 'old').activity, 'still here');
});

// Fixture: put a Run in a state that only later tickets' operations can reach.
const force = (cwd, id, fields) => writeFileSync(file(cwd, id), json({ ...read(cwd, id), ...fields }));
const transition = (cwd, id, to) => run(cwd, 'transition', '--id', id, '--to', to);
const defined = (cwd) => {
  const id = startRun(cwd);
  update(cwd, id, { spec_link: 'docs/specs/x.md', tickets: ['1', '2'], tickets_total: 2 });
  return id;
};

test('a Run cannot enter Build without a Spec and Tickets, and the message names what is missing', () => {
  const cwd = repo();
  const id = startRun(cwd);
  assert.equal(transition(cwd, id, 'prepare').status, 0);
  const before = read(cwd, id);
  let result = transition(cwd, id, 'build');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Spec/);
  update(cwd, id, { spec_link: 'docs/specs/x.md' });
  result = transition(cwd, id, 'build');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Tickets/);
  assert.equal(read(cwd, id).stage, before.stage);
  update(cwd, id, { tickets: ['1'], tickets_total: 1 });
  assert.equal(transition(cwd, id, 'build').status, 0);
  assert.equal(read(cwd, id).stage, 'build');
});

test('transitions follow Flow order and skipping a Stage is refused', () => {
  const cwd = repo();
  const id = defined(cwd);
  for (const to of ['build', 'check', 'finish', 'define', 'nonsense']) assert.notEqual(transition(cwd, id, to).status, 0, to);
  assert.equal(read(cwd, id).stage, 'define');
});

test('Check needs every counted Ticket done', () => {
  const cwd = repo();
  const id = defined(cwd);
  transition(cwd, id, 'prepare');
  transition(cwd, id, 'build');
  update(cwd, id, { tickets_done: 1 });
  assert.notEqual(transition(cwd, id, 'check').status, 0);
  update(cwd, id, { tickets_done: 2 });
  assert.equal(transition(cwd, id, 'check').status, 0);
  assert.equal(read(cwd, id).stage, 'check');
});

test('only an active Run can move: waiting, done and abandoned Runs refuse', () => {
  const cwd = repo();
  const id = defined(cwd);
  update(cwd, id, { status: 'waiting', waiting_reason: 'answer' });
  assert.notEqual(transition(cwd, id, 'prepare').status, 0);
  force(cwd, id, { status: 'done', waiting_on_human: false, waiting_reason: '' });
  assert.notEqual(transition(cwd, id, 'prepare').status, 0);
  assert.equal(read(cwd, id).stage, 'define');
});

test('rework is the way back from Check: it counts the loop, clears Evidence and stops at the limit', () => {
  const cwd = repo();
  const id = defined(cwd);
  assert.notEqual(run(cwd, 'rework', '--id', id).status, 0, 'not in Check');
  force(cwd, id, { stage: 'check', tickets_done: 2, standards: 'fail', spec: 'pass', security: 'pass', infrastructure: 'skipped', verify: { exit_code: 0 }, accepted: { decision: 'ok' } });
  assert.equal(run(cwd, 'rework', '--id', id).status, 0);
  const after = read(cwd, id);
  assert.equal(after.stage, 'build');
  assert.equal(after.check_loops, 1);
  for (const key of ['standards', 'spec', 'security', 'infrastructure', 'verify', 'accepted']) assert.equal(key in after, false, key);
  force(cwd, id, { stage: 'check', check_loops: 2 });
  assert.notEqual(run(cwd, 'rework', '--id', id).status, 0);
  assert.equal(read(cwd, id).stage, 'check');
});

test('complete ends a Run only at Finish with a PR link and sane Ticket counts', () => {
  const cwd = repo();
  const id = defined(cwd);
  force(cwd, id, { stage: 'build', tickets_done: 2 });
  assert.notEqual(run(cwd, 'complete', '--id', id).status, 0, 'not at Finish');
  force(cwd, id, { stage: 'finish' });
  assert.notEqual(run(cwd, 'complete', '--id', id).status, 0, 'no PR link');
  update(cwd, id, { pr: 'https://github.com/o/r/pull/1', tickets_done: 5 });
  assert.notEqual(run(cwd, 'complete', '--id', id).status, 0, 'more done than counted');
  update(cwd, id, { tickets_done: 2 });
  assert.equal(run(cwd, 'complete', '--id', id).status, 0);
  assert.equal(read(cwd, id).status, 'done');
  assert.notEqual(run(cwd, 'complete', '--id', id).status, 0, 'already done');
});
