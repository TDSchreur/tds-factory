import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, git } from './git-repo.js';

const cli = resolve('bin/tds-factory.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });
const ok = (cwd, ...args) => { const r = run(cwd, ...args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const file = (cwd, id) => join(cwd, '.factory', 'runs', id, 'run.json');
const read = (cwd, id) => JSON.parse(readFileSync(file(cwd, id), 'utf8'));
const start = (cwd) => ok(cwd, 'start', '--data', JSON.stringify({ title: 'Fast', agent: 'codex', commands: 'true', conventions: [] }));
const update = (cwd, id, data) => ok(cwd, 'update', '--id', id, '--data', JSON.stringify(data));
const verdict = (cwd, id, axis, value) => run(cwd, 'verdict', '--id', id, '--axis', axis, '--value', value);
const commit = (cwd, id) => { const w = read(cwd, id).worktree; git(w, 'commit', '-q', '--allow-empty', '-m', 'work'); };

function toCheck(cwd, id, tickets) {
  update(cwd, id, { spec_link: 'spec.md', tickets, tickets_total: tickets.length, tickets_done: tickets.length });
  ok(cwd, 'transition', '--id', id, '--to', 'build');
  commit(cwd, id);
  ok(cwd, 'transition', '--id', id, '--to', 'check');
  ok(cwd, 'verify', '--id', id);
}

test('the track is chosen in Define only, by the named command, and a record without one is Full', () => {
  const cwd = repo(), id = start(cwd);
  assert.equal(read(cwd, id).track, undefined);
  assert.notEqual(run(cwd, 'update', '--id', id, '--data', JSON.stringify({ track: 'fast' })).status, 0);
  assert.notEqual(run(cwd, 'start', '--data', JSON.stringify({ title: 'X', agent: 'codex', commands: 'true', conventions: [], track: 'fast' })).status, 0);
  assert.notEqual(run(cwd, 'track', '--id', id, '--value', 'turbo').status, 0);
  ok(cwd, 'track', '--id', id, '--value', 'fast');
  assert.equal(read(cwd, id).track, 'fast');
  toCheck(cwd, id, ['1']);
  const before = read(cwd, id);
  assert.notEqual(run(cwd, 'track', '--id', id, '--value', 'full').status, 0);
  assert.deepEqual(read(cwd, id), before);
});

test('a Fast track Run needs exactly one Ticket to build', () => {
  const cwd = repo(), id = start(cwd);
  ok(cwd, 'track', '--id', id, '--value', 'fast');
  update(cwd, id, { spec_link: 'spec.md', tickets: ['1', '2'], tickets_total: 2 });
  const r = run(cwd, 'transition', '--id', id, '--to', 'build');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /exactly one Ticket/);
  update(cwd, id, { tickets: ['1'], tickets_total: 1 });
  ok(cwd, 'transition', '--id', id, '--to', 'build');
});

test('Finish needs a clean or Accepted Check on both tracks; Standards and Security are always required', () => {
  for (const track of ['fast', 'full']) {
    const cwd = repo(), id = start(cwd);
    ok(cwd, 'track', '--id', id, '--value', track);
    toCheck(cwd, id, ['1']);
    ok(cwd, 'verdict', '--id', id, '--axis', 'spec', '--value', 'pass');
    ok(cwd, 'verdict', '--id', id, '--axis', 'infrastructure', '--value', 'skipped');
    assert.equal(verdict(cwd, id, 'security', 'pass').status, 0);
    assert.match(run(cwd, 'transition', '--id', id, '--to', 'finish').stderr, /standards has no verdict/, track);
    assert.notEqual(verdict(cwd, id, 'standards', 'skipped').status, 0);
    ok(cwd, 'verdict', '--id', id, '--axis', 'standards', '--value', 'fail');
    assert.match(run(cwd, 'transition', '--id', id, '--to', 'finish').stderr, /standards failed/, track);
    ok(cwd, 'accept', '--id', id, '--data', JSON.stringify({ findings: 'standards failed', decision: 'go on' }));
    ok(cwd, 'transition', '--id', id, '--to', 'finish');
  }
});

test('the Spec verdict may be skipped on the Fast track only', () => {
  const full = repo(), fullId = start(full);
  toCheck(full, fullId, ['1']);
  assert.notEqual(verdict(full, fullId, 'spec', 'skipped').status, 0);
  const cwd = repo(), id = start(cwd);
  ok(cwd, 'track', '--id', id, '--value', 'fast');
  toCheck(cwd, id, ['1']);
  for (const axis of ['standards', 'security']) ok(cwd, 'verdict', '--id', id, '--axis', axis, '--value', 'pass');
  ok(cwd, 'verdict', '--id', id, '--axis', 'spec', '--value', 'skipped');
  ok(cwd, 'verdict', '--id', id, '--axis', 'infrastructure', '--value', 'skipped');
  ok(cwd, 'transition', '--id', id, '--to', 'finish');
});

test('a skipped Spec verdict on a Run that is not Fast does not satisfy Finish', () => {
  const cwd = repo(), id = start(cwd);
  toCheck(cwd, id, ['1']);
  for (const axis of ['standards', 'security', 'spec', 'infrastructure']) ok(cwd, 'verdict', '--id', id, '--axis', axis, '--value', 'pass');
  const forged = { ...read(cwd, id), spec: 'skipped' };
  writeFileSync(file(cwd, id), JSON.stringify(forged));
  assert.match(run(cwd, 'transition', '--id', id, '--to', 'finish').stderr, /spec cannot be skipped on this track/);
});

test('stats show the track per Run and totals per track, counting a Run without a track as Full', () => {
  const cwd = repo(), fast = start(cwd), full = start(cwd);
  ok(cwd, 'track', '--id', fast, '--value', 'fast');
  assert.match(ok(cwd, 'stats', '--id', fast), /Track: Fast/);
  assert.match(ok(cwd, 'stats', '--id', full), /Track: Full/);
  const all = ok(cwd, 'stats', '--all');
  assert.match(all, /Total observed, Fast track \(1 Run\(s\)\)/);
  assert.match(all, /Total observed, Full track \(1 Run\(s\)\)/);
});
