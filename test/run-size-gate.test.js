import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cli as runCli } from './cli-runner.js';
import { repo, git } from './git-repo.js';
import { growsOverTheLimit } from '../src/run-lifecycle.js';

const REASON = 'Run size over the limit: split the remaining Tickets into a new Run?';
/**
 * @param {string} cwd
 * @param {...string} args
 */
const run = (cwd, ...args) => runCli(cwd, 'run', ...args);
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
async function inBuild(files) {
  const cwd = repo();
  const started = await run(
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
  assert.equal((await run(cwd, 'update', '--id', id, '--data', JSON.stringify(data))).status, 0);
  assert.equal((await run(cwd, 'transition', '--id', id, '--to', 'build')).status, 0);
  return { cwd, id };
}
const over = async () => await inBuild({ 'big.txt': 'x'.repeat(50 * 1024) });
const under = async () => await inBuild({ 'small.txt': 'x\n' });
/** @param {{ cwd: string, id: string }} r @param {number} done */
const finish = async ({ cwd, id }, done) =>
  await run(cwd, 'update', '--id', id, '--data', JSON.stringify({ tickets_done: done }));

test('raising tickets_done over the limit with Tickets left waits with the reason, and the update succeeds', async () => {
  const r = await over();
  const result = await finish(r, 1);
  assert.equal(result.status, 0, result.stderr);
  const saved = record(r.cwd, r.id);
  assert.equal(saved.tickets_done, 1);
  assert.equal(saved.status, 'waiting');
  assert.equal(saved.waiting_on_human, true);
  assert.equal(saved.waiting_reason, REASON);
  assert.ok(events(r.cwd, r.id).some((e) => e.type === 'waiting' && e.reason === REASON));
});

test('no wait under the limit, on the last Ticket, after accept, or outside Build', async () => {
  const small = await under();
  assert.equal((await finish(small, 1)).status, 0);
  assert.equal(record(small.cwd, small.id).status, 'running');

  const last = await over();
  assert.equal((await finish(last, 4)).status, 0);
  assert.equal(record(last.cwd, last.id).status, 'running');

  const accepted = await over();
  assert.equal((await finish(accepted, 1)).status, 0);
  assert.equal((await run(accepted.cwd, 'size', '--id', accepted.id, '--accept')).status, 0);
  assert.equal((await finish(accepted, 2)).status, 0);
  assert.equal(record(accepted.cwd, accepted.id).status, 'running');

  const early = await over();
  const record0 = record(early.cwd, early.id);
  const path = join(early.cwd, '.factory', 'runs', early.id, 'run.json');
  writeFileSync(path, JSON.stringify({ ...record0, stage: 'define' }));
  assert.equal((await finish(early, 1)).status, 0);
  assert.equal(record(early.cwd, early.id).status, 'running');
});

test('a Ticket count that does not rise does not wait', async () => {
  const r = await over();
  assert.equal((await run(r.cwd, 'update', '--id', r.id, '--data', JSON.stringify({ activity: 'working' }))).status, 0);
  assert.equal(record(r.cwd, r.id).status, 'running');
});

test('split keeps the done Tickets, prints the moved links, releases the Run and logs a split event', async () => {
  const r = await over();
  await finish(r, 2);
  const result = await run(r.cwd, 'split', '--id', r.id);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 't3\nt4\n');
  assert.doesNotMatch(result.stderr, /note:/);
  const saved = record(r.cwd, r.id);
  assert.deepEqual(saved.tickets, ['t1', 't2']);
  assert.equal(saved.tickets_total, 2);
  assert.equal(saved.status, 'running');
  assert.equal(saved.waiting_on_human, false);
  assert.equal(saved.waiting_reason, '');
  assert.equal(saved.activity, 'Split: the remaining Tickets move to a new Run');
  const split = events(r.cwd, r.id).find((e) => e.type === 'split');
  assert.deepEqual(split.moved, ['t3', 't4']);
  assert.equal((await run(r.cwd, 'transition', '--id', r.id, '--to', 'check')).status, 0);
});

test('size --accept sets size_accepted, releases the Run and logs the size', async () => {
  const r = await over();
  await finish(r, 1);
  const result = await run(r.cwd, 'size', '--id', r.id, '--accept');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /note:/);
  const saved = record(r.cwd, r.id);
  assert.ok(!Number.isNaN(Date.parse(saved.size_accepted)));
  assert.equal(saved.status, 'running');
  const accepted = events(r.cwd, r.id).find((e) => e.type === 'size-accepted');
  assert.equal(accepted.files, 1);
  assert.ok(accepted.bytes > 50 * 1024);
});

test('size --accept works on a running Run in Build and in Check', async () => {
  const inBuildRun = await over();
  await finish(inBuildRun, 4);
  assert.equal((await run(inBuildRun.cwd, 'size', '--id', inBuildRun.id, '--accept')).status, 0);
  assert.ok(record(inBuildRun.cwd, inBuildRun.id).size_accepted);
  assert.equal(record(inBuildRun.cwd, inBuildRun.id).status, 'running');

  const inCheckRun = await over();
  await finish(inCheckRun, 4);
  assert.equal((await run(inCheckRun.cwd, 'transition', '--id', inCheckRun.id, '--to', 'check')).status, 0);
  assert.equal(record(inCheckRun.cwd, inCheckRun.id).stage, 'check');
  assert.equal((await run(inCheckRun.cwd, 'size', '--id', inCheckRun.id, '--accept')).status, 0);
  assert.ok(record(inCheckRun.cwd, inCheckRun.id).size_accepted);
});

test('the transition to Check warns about the size, and not after accept', async () => {
  const r = await over();
  await finish(r, 4);
  const before = await run(r.cwd, 'transition', '--id', r.id, '--to', 'check');
  assert.match(before.stderr, /warning: the diff is 50 KB/);

  const s = await over();
  await finish(s, 4);
  assert.equal((await run(s.cwd, 'size', '--id', s.id, '--accept')).status, 0);
  const after = await run(s.cwd, 'transition', '--id', s.id, '--to', 'check');
  assert.equal(after.status, 0, after.stderr);
  assert.doesNotMatch(after.stderr, /warning: the diff/);
});

test('split refuses a Run that does not wait for size', async () => {
  const r = await over();
  const result = await run(r.cwd, 'split', '--id', r.id);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /waits for the Run size/);
});

test('size --accept on a running Run in Build is accepted', async () => {
  const r = await under();
  assert.equal((await run(r.cwd, 'size', '--id', r.id, '--accept')).status, 0);
});

test('split and size --accept refuse a Run that waits for something else', async () => {
  const waiting = await over();
  await finish(waiting, 1);
  const path = join(waiting.cwd, '.factory', 'runs', waiting.id, 'run.json');
  writeFileSync(path, JSON.stringify({ ...record(waiting.cwd, waiting.id), waiting_reason: 'Something else' }));
  const split = await run(waiting.cwd, 'split', '--id', waiting.id);
  assert.notEqual(split.status, 0);
  assert.match(split.stderr, /Run size/);
  const accept = await run(waiting.cwd, 'size', '--id', waiting.id, '--accept');
  assert.notEqual(accept.status, 0);
  assert.match(accept.stderr, /Run size/);
  assert.equal(record(waiting.cwd, waiting.id).waiting_reason, 'Something else');
});

test('size --accept refuses a Run outside Build and Check, and a second accept', async () => {
  const r = await over();
  assert.equal((await run(r.cwd, 'size', '--id', r.id, '--accept')).status, 0);
  const second = await run(r.cwd, 'size', '--id', r.id, '--accept');
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /already accepted/);
  const path = join(r.cwd, '.factory', 'runs', r.id, 'run.json');
  writeFileSync(path, JSON.stringify({ ...record(r.cwd, r.id), size_accepted: undefined, stage: 'define' }));
  const result = await run(r.cwd, 'size', '--id', r.id, '--accept');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Build or Check/);
});

test('run update refuses size_accepted', async () => {
  const r = await over();
  const result = await run(
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

test('size without --accept prints the size and writes nothing', async () => {
  const r = await over();
  const file = join(r.cwd, '.factory', 'runs', r.id, 'run.json');
  const before = readFileSync(file, 'utf8');
  const result = await run(r.cwd, 'size', '--id', r.id);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^1 file, 50 KB/);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test(
  'a Ticket link with a control character is printed without it',
  { skip: process.platform === 'win32' && 'needs control characters in a link' },
  async () => {
    const r = await over();
    const links = ['t1', 't2\nwarning: forged', 't3'];
    assert.equal((await run(r.cwd, 'update', '--id', r.id, '--data', JSON.stringify({ tickets: links }))).status, 0);
    await finish(r, 1);
    const result = await run(r.cwd, 'split', '--id', r.id);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.split('\n').length, 3);
    assert.doesNotMatch(result.stdout, /^warning/m);
  },
);

test(
  'bidi and line separator characters in a Ticket link are replaced in the split output',
  { skip: process.platform === 'win32' && 'needs special characters in a link' },
  async () => {
    const r = await over();
    const evil = ['t1', 'a\u2028b\u2029c\u202ed\u2066e\u2069f\u202ag\u202cX'];
    assert.equal(
      (await run(r.cwd, 'update', '--id', r.id, '--data', JSON.stringify({ tickets: [...evil, 't3'] }))).status,
      0,
    );
    await finish(r, 1);
    const result = await run(r.cwd, 'split', '--id', r.id);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /[\u2028\u2029\u202a-\u202e\u2066-\u2069]/);
    assert.equal(result.stdout.split('\n').length, 3);
  },
);

test(
  'split prints the moved links even when the event log cannot be written',
  { skip: process.platform === 'win32' },
  async () => {
    const r = await over();
    await finish(r, 2);
    const log = join(r.cwd, '.factory', 'runs', r.id, 'events.jsonl');
    rmSync(log, { force: true });
    mkdirSync(log);
    const result = await run(r.cwd, 'split', '--id', r.id);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 't3\nt4\n');
    assert.deepEqual(record(r.cwd, r.id).tickets, ['t1', 't2']);
  },
);

/** @param {{ cwd: string, id: string }} r the event log becomes a symbolic link, which appendEvent refuses */
function linkTheLog({ cwd, id }) {
  const log = join(cwd, '.factory', 'runs', id, 'events.jsonl');
  const elsewhere = join(cwd, 'elsewhere.jsonl');
  writeFileSync(elsewhere, '');
  rmSync(log, { force: true });
  symlinkSync(elsewhere, log);
  return elsewhere;
}

test(
  'split with a symbolic link as event log still prints the links, exits 0 and notes the lost event',
  { skip: process.platform === 'win32' && 'needs symbolic links' },
  async () => {
    const r = await over();
    await finish(r, 2);
    const elsewhere = linkTheLog(r);
    const result = await run(r.cwd, 'split', '--id', r.id);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 't3\nt4\n');
    assert.match(result.stderr, /^note: the split event could not be recorded/m);
    assert.deepEqual(record(r.cwd, r.id).tickets, ['t1', 't2']);
    assert.equal(readFileSync(elsewhere, 'utf8'), '');
  },
);

test(
  'size --accept with a symbolic link as event log records the acceptance and notes the lost event',
  { skip: process.platform === 'win32' && 'needs symbolic links' },
  async () => {
    const r = await over();
    await finish(r, 1);
    const elsewhere = linkTheLog(r);
    const result = await run(r.cwd, 'size', '--id', r.id, '--accept');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /^note: the size-accepted event could not be recorded/m);
    assert.ok(record(r.cwd, r.id).size_accepted);
    assert.equal(record(r.cwd, r.id).status, 'running');
    assert.equal(readFileSync(elsewhere, 'utf8'), '');
  },
);

test('a git timeout makes the Run wait through the size gate like an over-limit Run', async () => {
  const r = await under();
  const old = record(r.cwd, r.id);
  const next = { ...old, tickets_done: 1 };
  const timeout = () => ({
    status: null,
    stdout: '',
    stderr: '',
    error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
  });
  assert.equal(growsOverTheLimit(r.cwd, r.id, old, next), false);
  assert.equal(growsOverTheLimit(r.cwd, r.id, old, next, { git: timeout }), true);
  assert.equal(growsOverTheLimit(r.cwd, r.id, old, { ...next, size_accepted: 'now' }, { git: timeout }), false);
  assert.equal(growsOverTheLimit(r.cwd, r.id, old, { ...next, tickets_done: 4 }, { git: timeout }), false);
});

test('run size prints the size of a normal Run in files and KB', async () => {
  const r = await over();
  const result = await run(r.cwd, 'size', '--id', r.id);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '1 file, 50 KB\n');
});
