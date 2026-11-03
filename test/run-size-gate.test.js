import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, git } from './git-repo.js';

const cli = resolve('bin/tds-factory.js');
const REASON = 'Run size over the limit: split the remaining Tickets into a new Run?';
/**
 * @param {string} cwd
 * @param {...string} args
 */
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });
/** @param {string} cwd @param {string} id */
const record = (cwd, id) => JSON.parse(readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8'));
/** @param {string} cwd @param {string} id */
const events = (cwd, id) =>
  readFileSync(join(cwd, '.factory', 'runs', id, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

// A Run in Build with four Tickets, none done, and `files` committed in its worktree.
/** @param {Record<string, string>} files */
function inBuild(files) {
  const cwd = repo();
  const started = run(
    cwd,
    'start',
    '--data',
    JSON.stringify({ title: 'Gate', agent: 'claude', commands: 'true', conventions: [] }),
  );
  assert.equal(started.status, 0, started.stderr);
  const id = started.stdout.trim();
  const { worktree } = record(cwd, id);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(worktree, name)), { recursive: true });
    writeFileSync(join(worktree, name), text);
  }
  git(worktree, 'add', '.');
  git(worktree, 'commit', '-q', '-m', 'change');
  const data = { spec_link: 'docs/specs/x.md', tickets: ['t1', 't2', 't3', 't4'], tickets_done: 0 };
  assert.equal(run(cwd, 'update', '--id', id, '--data', JSON.stringify(data)).status, 0);
  assert.equal(run(cwd, 'transition', '--id', id, '--to', 'build').status, 0);
  return { cwd, id };
}
const over = () => inBuild({ 'big.txt': 'x'.repeat(50 * 1024) });
const under = () => inBuild({ 'small.txt': 'x\n' });
/** @param {{ cwd: string, id: string }} r @param {number} done */
const finish = ({ cwd, id }, done) => run(cwd, 'update', '--id', id, '--data', JSON.stringify({ tickets_done: done }));

test('raising tickets_done over the limit with Tickets left waits with the reason, and the update succeeds', () => {
  const r = over();
  const result = finish(r, 1);
  assert.equal(result.status, 0, result.stderr);
  const saved = record(r.cwd, r.id);
  assert.equal(saved.tickets_done, 1);
  assert.equal(saved.status, 'waiting');
  assert.equal(saved.waiting_on_human, true);
  assert.equal(saved.waiting_reason, REASON);
  assert.ok(events(r.cwd, r.id).some((e) => e.type === 'waiting' && e.reason === REASON));
});

test('no wait under the limit, on the last Ticket, after accept, or outside Build', () => {
  const small = under();
  assert.equal(finish(small, 1).status, 0);
  assert.equal(record(small.cwd, small.id).status, 'running');

  const last = over();
  assert.equal(finish(last, 4).status, 0);
  assert.equal(record(last.cwd, last.id).status, 'running');

  const accepted = over();
  assert.equal(finish(accepted, 1).status, 0);
  assert.equal(run(accepted.cwd, 'size', '--id', accepted.id, '--accept').status, 0);
  assert.equal(finish(accepted, 2).status, 0);
  assert.equal(record(accepted.cwd, accepted.id).status, 'running');

  const early = over();
  const record0 = record(early.cwd, early.id);
  const path = join(early.cwd, '.factory', 'runs', early.id, 'run.json');
  writeFileSync(path, JSON.stringify({ ...record0, stage: 'define' }));
  assert.equal(finish(early, 1).status, 0);
  assert.equal(record(early.cwd, early.id).status, 'running');
});

test('a Ticket count that does not rise does not wait', () => {
  const r = over();
  assert.equal(run(r.cwd, 'update', '--id', r.id, '--data', JSON.stringify({ activity: 'working' })).status, 0);
  assert.equal(record(r.cwd, r.id).status, 'running');
});

test('split keeps the done Tickets, prints the moved links, releases the Run and logs a split event', () => {
  const r = over();
  finish(r, 2);
  const result = run(r.cwd, 'split', '--id', r.id);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 't3\nt4\n');
  const saved = record(r.cwd, r.id);
  assert.deepEqual(saved.tickets, ['t1', 't2']);
  assert.equal(saved.tickets_total, 2);
  assert.equal(saved.status, 'running');
  assert.equal(saved.waiting_on_human, false);
  assert.equal(saved.waiting_reason, '');
  assert.equal(saved.activity, 'Split: the remaining Tickets move to a new Run');
  const split = events(r.cwd, r.id).find((e) => e.type === 'split');
  assert.deepEqual(split.moved, ['t3', 't4']);
  assert.equal(run(r.cwd, 'transition', '--id', r.id, '--to', 'check').status, 0);
});

test('size --accept sets size_accepted, releases the Run and logs the size', () => {
  const r = over();
  finish(r, 1);
  const result = run(r.cwd, 'size', '--id', r.id, '--accept');
  assert.equal(result.status, 0, result.stderr);
  const saved = record(r.cwd, r.id);
  assert.ok(!Number.isNaN(Date.parse(saved.size_accepted)));
  assert.equal(saved.status, 'running');
  const accepted = events(r.cwd, r.id).find((e) => e.type === 'size-accepted');
  assert.equal(accepted.files, 1);
  assert.ok(accepted.bytes > 50 * 1024);
});

test('size --accept works on a running Run in Build and in Check, and silences the transition warning', () => {
  const r = over();
  finish(r, 4);
  const before = run(r.cwd, 'transition', '--id', r.id, '--to', 'check');
  assert.match(before.stderr, /warning: the diff is 50 KB/);

  const s = over();
  finish(s, 4);
  assert.equal(run(s.cwd, 'size', '--id', s.id, '--accept').status, 0);
  assert.equal(record(s.cwd, s.id).status, 'running');
  const after = run(s.cwd, 'transition', '--id', s.id, '--to', 'check');
  assert.equal(after.status, 0, after.stderr);
  assert.doesNotMatch(after.stderr, /warning: the diff/);
  const again = over();
  finish(again, 4);
  run(again.cwd, 'transition', '--id', again.id, '--to', 'check');
  assert.equal(record(again.cwd, again.id).stage, 'check');
  assert.equal(run(again.cwd, 'size', '--id', again.id, '--accept').status, 0);
  assert.ok(record(again.cwd, again.id).size_accepted);
});

test('split and size --accept refuse a Run that does not wait for size in Build', () => {
  const r = over();
  for (const args of [['split'], ['size', '--accept']]) {
    const unrelated = args[0] === 'split' ? r : under();
    const result = run(unrelated.cwd, args[0], '--id', unrelated.id, ...args.slice(1));
    if (args[0] === 'split') {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /waits for the Run size/);
    } else assert.equal(result.status, 0, 'a running Run in Build may be accepted');
  }
  const waiting = over();
  finish(waiting, 1);
  const path = join(waiting.cwd, '.factory', 'runs', waiting.id, 'run.json');
  writeFileSync(path, JSON.stringify({ ...record(waiting.cwd, waiting.id), waiting_reason: 'Something else' }));
  for (const args of [['split'], ['size', '--accept']]) {
    const result = run(waiting.cwd, args[0], '--id', waiting.id, ...args.slice(1));
    assert.notEqual(result.status, 0, args.join(' '));
    assert.match(result.stderr, /Run size/);
  }
  assert.equal(record(waiting.cwd, waiting.id).waiting_reason, 'Something else');
});

test('size --accept refuses a Run outside Build and Check, and a second accept', () => {
  const r = over();
  assert.equal(run(r.cwd, 'size', '--id', r.id, '--accept').status, 0);
  const second = run(r.cwd, 'size', '--id', r.id, '--accept');
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /already accepted/);
  const path = join(r.cwd, '.factory', 'runs', r.id, 'run.json');
  writeFileSync(path, JSON.stringify({ ...record(r.cwd, r.id), size_accepted: undefined, stage: 'define' }));
  const result = run(r.cwd, 'size', '--id', r.id, '--accept');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Build or Check/);
});

test('run update refuses size_accepted', () => {
  const r = over();
  const result = run(
    r.cwd,
    'update',
    '--id',
    r.id,
    '--data',
    JSON.stringify({ size_accepted: '2026-01-01T00:00:00Z' }),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /size_accepted can only change through a Run transition/);
  assert.equal(record(r.cwd, r.id).size_accepted, undefined);
});

test('size without --accept prints the size and writes nothing', () => {
  const r = over();
  const file = join(r.cwd, '.factory', 'runs', r.id, 'run.json');
  const before = readFileSync(file, 'utf8');
  const result = run(r.cwd, 'size', '--id', r.id);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^1 file, 50 KB/);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test(
  'a Ticket link with a control character is printed without it',
  { skip: process.platform === 'win32' && 'needs control characters in a link' },
  () => {
    const r = over();
    const links = ['t1', 't2\nwarning: forged', 't3'];
    assert.equal(run(r.cwd, 'update', '--id', r.id, '--data', JSON.stringify({ tickets: links })).status, 0);
    finish(r, 1);
    const result = run(r.cwd, 'split', '--id', r.id);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.split('\n').length, 3);
    assert.doesNotMatch(result.stdout, /^warning/m);
  },
);
