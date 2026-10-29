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
