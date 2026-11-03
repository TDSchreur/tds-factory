import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repo } from './git-repo.js';
import { defined as present } from './run-view.js';
import {
  run,
  json,
  file,
  read,
  startRun,
  update,
  force,
  transition,
  head,
  WHERE,
  verify,
  verdict,
  commit,
  cleanCheck,
  refusesFinish,
  problems,
} from './run-gates-helpers.js';

/** @import { Run } from '../src/run-record.js' */

test('run update still takes activity, links, counters, waiting and abandoned', () => {
  const cwd = repo();
  const id = startRun(cwd);
  assert.equal(
    update(cwd, id, {
      activity: 'working',
      spec_link: 'docs/specs/x.md',
      tickets: ['1'],
      tickets_total: 1,
      tickets_done: 1,
    }).status,
    0,
  );
  assert.equal(update(cwd, id, { status: 'waiting', waiting_reason: 'answer' }).status, 0);
  assert.equal(update(cwd, id, { status: 'running' }).status, 0);
  assert.equal(update(cwd, id, { status: 'abandoned' }).status, 0);
  assert.equal(read(cwd, id).status, 'abandoned');
});

test('a Run cannot enter Build without a Spec and Tickets, and the message names what is missing', () => {
  const cwd = repo();
  const id = startRun(cwd);
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

test('verify runs the Verify command in the Run worktree and records what happened', () => {
  const cwd = repo();
  const id = startRun(cwd, `echo from-verify && ${WHERE}`);
  const result = verify(cwd, id);
  assert.equal(result.status, 0, result.stderr);
  const { verify: verified, worktree } = read(cwd, id);
  const recorded = present(verified, 'Verify is recorded');
  assert.equal(recorded.command, `echo from-verify && ${WHERE}`);
  assert.equal(recorded.cwd, worktree);
  assert.equal(recorded.head, head(cwd, id));
  assert.equal(recorded.dirty, false);
  assert.equal(recorded.exit_code, 0);
  assert.ok(Date.parse(recorded.started) <= Date.parse(recorded.ended));
  const log = readFileSync(join(cwd, '.factory', 'runs', id, recorded.log), 'utf8');
  assert.match(log, /from-verify/);
  assert.ok(log.includes(worktree));
});

test('a Run cannot start with, or be given, a blank or NUL-containing Verify command', () => {
  const cwd = repo();
  for (const commands of ['   ', 'npm\0 test']) {
    const start = run(cwd, 'start', '--data', json({ title: 'Example', agent: 'codex', commands, conventions: [] }));
    assert.notEqual(start.status, 0, json(commands));
  }
  const id = startRun(cwd, '');
  for (const commands of ['   ', 'npm\0 test'])
    assert.notEqual(update(cwd, id, { commands }).status, 0, json(commands));
  assert.equal(read(cwd, id).commands, '');
  assert.equal(update(cwd, id, { commands: 'npm test' }).status, 0);
});

test('verdicts are refused outside Check, for unknown axes and impossible values', () => {
  const cwd = repo();
  const id = startRun(cwd);
  assert.notEqual(verdict(cwd, id, 'standards', 'pass').status, 0, 'not in Check');
  force(cwd, id, { stage: 'check' });
  assert.notEqual(verdict(cwd, id, 'style', 'pass').status, 0, 'unknown axis');
  assert.notEqual(verdict(cwd, id, 'standards', 'skipped').status, 0, 'only Infrastructure may be skipped');
  assert.notEqual(verdict(cwd, id, 'standards', 'maybe').status, 0, 'unknown value');
  assert.equal('standards' in read(cwd, id), false);
});

test('Evidence goes stale when the head changes or the worktree is dirty', () => {
  const cwd = repo();
  let id = cleanCheck(cwd);
  commit(cwd, id);
  refusesFinish(cwd, id, 'new commit after review');
  id = cleanCheck(cwd);
  writeFileSync(join(read(cwd, id).worktree, 'scratch.txt'), 'x');
  refusesFinish(cwd, id, 'dirty worktree');
  id = startRun(cwd);
  writeFileSync(join(read(cwd, id).worktree, 'scratch.txt'), 'x');
  force(cwd, id, { stage: 'check' });
  verify(cwd, id);
  force(cwd, id, {
    standards: 'pass',
    spec: 'pass',
    security: 'pass',
    infrastructure: 'skipped',
    reviewed: Object.fromEntries(
      ['standards', 'spec', 'security', 'infrastructure'].map((a) => [a, { head: head(cwd, id), attempt: 1 }]),
    ),
  });
  refusesFinish(cwd, id, 'Verify result from a dirty tree');
});

test('inspect reports a missing worktree, one git does not know, and uncommitted changes', () => {
  const cwd = repo();
  const gone = startRun(cwd);
  rmSync(read(cwd, gone).worktree, { recursive: true });
  assert.deepEqual(problems(cwd, gone), ['worktree-missing']);
  const stranger = startRun(cwd);
  force(cwd, stranger, { worktree: mkdtempSync(join(tmpdir(), 'not-a-worktree-')) });
  assert.deepEqual(problems(cwd, stranger), ['worktree-unknown']);
  const dirty = startRun(cwd);
  writeFileSync(join(read(cwd, dirty).worktree, 'scratch.txt'), 'x');
  assert.deepEqual(problems(cwd, dirty), ['worktree-dirty']);
});

test('inspect leaves finished Runs without a worktree alone and changes nothing on disk', () => {
  const cwd = repo();
  const id = startRun(cwd);
  const finished = startRun(cwd);
  rmSync(read(cwd, finished).worktree, { recursive: true });
  force(cwd, finished, { status: 'done' });
  const snapshot = () =>
    readdirSync(join(cwd, '.factory', 'runs'), { recursive: true, encoding: 'utf8' })
      .map((name) => join(cwd, '.factory', 'runs', name))
      .filter((name) => statSync(name).isFile())
      .sort()
      .map((name) => ` ${createHash('sha1').update(readFileSync(name)).digest('hex')}`)
      .join('\n');
  const before = snapshot();
  assert.deepEqual(problems(cwd, finished), []);
  assert.equal(snapshot(), before);
  const text = run(cwd, 'inspect', '--id', id);
  assert.equal(text.status, 0);
  assert.match(text.stdout, /no problems/i);
  assert.notEqual(run(cwd, 'inspect', '--id', 'missing').status, 0);
});

test(
  'unavailable Verify and interrupted Verify have separate pause states',
  { skip: process.platform === 'win32' && 'needs POSIX signals: kill -TERM' },
  () => {
    const cwd = repo();
    const missing = startRun(cwd, 'tds_missing_verify_command_123');
    assert.notEqual(verify(cwd, missing).status, 0);
    assert.equal(read(cwd, missing).status, 'verification-unavailable');
    assert.match(read(cwd, missing).status_reason ?? '', /not found|unavailable/i);
    assert.notEqual(read(cwd, missing).verify?.exit_code, 0);
    const killed = startRun(cwd, 'kill -TERM $$');
    assert.notEqual(verify(cwd, killed).status, 0);
    assert.equal(read(cwd, killed).status, 'interrupted');
    assert.match(read(cwd, killed).status_reason ?? '', /SIGTERM/);
    assert.notEqual(read(cwd, killed).verify?.exit_code, 0);
  },
);

test('run update refuses hostile ticket values and leaves the record unchanged', () => {
  const cwd = repo();
  const id = startRun(cwd);
  const before = readFileSync(file(cwd, id), 'utf8');
  for (const data of [
    { tickets: 'x' },
    { tickets: null },
    { tickets: [1] },
    { tickets_total: -1 },
    { tickets_total: Number.MAX_SAFE_INTEGER + 1 },
    { tickets_total: '2' },
    { tickets: [], tickets_total: 1 },
  ])
    assert.notEqual(update(cwd, id, data).status, 0, json(data));
  assert.equal(run(cwd, 'update', '--id', id, '--data', '{"tickets_total":NaN}').status === 0, false);
  assert.equal(readFileSync(file(cwd, id), 'utf8'), before);
});
