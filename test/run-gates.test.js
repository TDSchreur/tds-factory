import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { git, repo } from './git-repo.js';

const cli = resolve('bin/tds-factory.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });
const json = (value) => JSON.stringify(value);
const file = (cwd, id) => join(cwd, '.factory', 'runs', id, 'run.json');
const read = (cwd, id) => JSON.parse(readFileSync(file(cwd, id), 'utf8'));
const startRun = (cwd, commands = 'npm test') => {
  const result = run(cwd, 'start', '--data', json({ title: 'Example', agent: 'codex', commands, conventions: [] }));
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
  force(cwd, id, { stage: 'check', tickets_done: 2, standards: 'fail', spec: 'pass', security: 'pass', infrastructure: 'skipped', verify: { exit_code: 0 }, reviewed: { standards: { head: 'a', attempt: 1 } }, accepted: { decision: 'ok' } });
  assert.equal(run(cwd, 'rework', '--id', id).status, 0);
  const after = read(cwd, id);
  assert.equal(after.stage, 'build');
  assert.equal(after.check_loops, 1);
  for (const key of ['standards', 'spec', 'security', 'infrastructure', 'verify', 'reviewed', 'accepted']) assert.equal(key in after, false, key);
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

const head = (cwd, id) => git(read(cwd, id).worktree, 'rev-parse', 'HEAD');
const verify = (cwd, id) => run(cwd, 'verify', '--id', id);
const verdict = (cwd, id, axis, value) => run(cwd, 'verdict', '--id', id, '--axis', axis, '--value', value);

test('verify runs the Verify command in the Run worktree and records what happened', () => {
  const cwd = repo();
  const id = startRun(cwd, 'echo from-verify && pwd');
  const result = verify(cwd, id);
  assert.equal(result.status, 0, result.stderr);
  const { verify: recorded, worktree } = read(cwd, id);
  assert.equal(recorded.command, 'echo from-verify && pwd');
  assert.equal(recorded.cwd, worktree);
  assert.equal(recorded.head, head(cwd, id));
  assert.equal(recorded.dirty, false);
  assert.equal(recorded.exit_code, 0);
  assert.ok(Date.parse(recorded.started) <= Date.parse(recorded.ended));
  const log = readFileSync(join(cwd, '.factory', 'runs', id, recorded.log), 'utf8');
  assert.match(log, /from-verify/);
  assert.ok(log.includes(worktree));
});

test('a failing Verify command is recorded with its exit code and fails the CLI', () => {
  const cwd = repo();
  const id = startRun(cwd, 'echo oops >&2; exit 3');
  const result = verify(cwd, id);
  assert.notEqual(result.status, 0);
  const { verify: recorded } = read(cwd, id);
  assert.equal(recorded.exit_code, 3);
  assert.match(readFileSync(join(cwd, '.factory', 'runs', id, recorded.log), 'utf8'), /oops/);
});

test('a Verify result from an uncommitted tree is marked dirty', () => {
  const cwd = repo();
  const id = startRun(cwd, 'true');
  writeFileSync(join(read(cwd, id).worktree, 'scratch.txt'), 'x');
  assert.equal(verify(cwd, id).status, 0);
  assert.equal(read(cwd, id).verify.dirty, true);
});

test('verify refuses a Run with no Verify command, and verify results cannot be written by update', () => {
  const cwd = repo();
  const id = startRun(cwd, '');
  assert.notEqual(verify(cwd, id).status, 0);
  assert.equal('verify' in read(cwd, id), false);
  assert.notEqual(update(cwd, id, { verify: { exit_code: 0 } }).status, 0);
});

test('a verdict is stamped with the head and the Check attempt', () => {
  const cwd = repo();
  const id = startRun(cwd);
  force(cwd, id, { stage: 'check' });
  assert.equal(verdict(cwd, id, 'standards', 'pass').status, 0);
  assert.equal(read(cwd, id).standards, 'pass');
  assert.deepEqual(read(cwd, id).reviewed.standards, { head: head(cwd, id), attempt: 1 });
  force(cwd, id, { check_loops: 1 });
  assert.equal(verdict(cwd, id, 'infrastructure', 'skipped').status, 0);
  assert.equal(read(cwd, id).reviewed.infrastructure.attempt, 2);
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

test('a passing verdict on an uncommitted tree is refused, a failing one is recorded', () => {
  const cwd = repo();
  const id = startRun(cwd);
  force(cwd, id, { stage: 'check' });
  writeFileSync(join(read(cwd, id).worktree, 'scratch.txt'), 'x');
  assert.notEqual(verdict(cwd, id, 'security', 'pass').status, 0);
  assert.equal('security' in read(cwd, id), false);
  assert.equal(verdict(cwd, id, 'security', 'fail').status, 0);
  assert.equal(read(cwd, id).security, 'fail');
});

const accept = (cwd, id, data) => run(cwd, 'accept', '--id', id, '--data', json(data));
const commit = (cwd, id) => git(read(cwd, id).worktree, 'commit', '-q', '--allow-empty', '-m', 'more work');
// A Run in Check whose Verify result and verdicts are all current and passing.
const cleanCheck = (cwd, commands = 'true') => {
  const id = startRun(cwd, commands);
  force(cwd, id, { stage: 'check', tickets: ['1'], tickets_total: 1, tickets_done: 1 });
  verify(cwd, id);
  for (const [axis, value] of [['standards', 'pass'], ['spec', 'pass'], ['security', 'pass'], ['infrastructure', 'skipped']]) assert.equal(verdict(cwd, id, axis, value).status, 0);
  return id;
};
const refusesFinish = (cwd, id, why) => {
  const before = read(cwd, id);
  assert.notEqual(transition(cwd, id, 'finish').status, 0, why);
  assert.deepEqual(read(cwd, id), before, why);
};

test('a clean Check with current Evidence reaches Finish, and the Run can be completed', () => {
  const cwd = repo();
  const id = cleanCheck(cwd);
  assert.equal(transition(cwd, id, 'finish').status, 0);
  assert.equal(read(cwd, id).stage, 'finish');
  update(cwd, id, { pr: 'https://github.com/o/r/pull/1' });
  assert.equal(run(cwd, 'complete', '--id', id).status, 0);
  assert.equal(read(cwd, id).status, 'done');
});

test('Finish is refused with a failed axis, a missing verdict or a failed Verify result', () => {
  const cwd = repo();
  let id = cleanCheck(cwd);
  assert.equal(verdict(cwd, id, 'security', 'fail').status, 0);
  refusesFinish(cwd, id, 'failed axis');
  id = startRun(cwd);
  force(cwd, id, { stage: 'check' });
  verify(cwd, id);
  verdict(cwd, id, 'standards', 'pass');
  refusesFinish(cwd, id, 'missing verdicts');
  id = cleanCheck(cwd, 'exit 1');
  refusesFinish(cwd, id, 'failed Verify');
  id = cleanCheck(cwd);
  force(cwd, id, { verify: undefined });
  refusesFinish(cwd, id, 'no Verify result');
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
  force(cwd, id, { standards: 'pass', spec: 'pass', security: 'pass', infrastructure: 'skipped', reviewed: Object.fromEntries(['standards', 'spec', 'security', 'infrastructure'].map((a) => [a, { head: head(cwd, id), attempt: 1 }])) });
  refusesFinish(cwd, id, 'Verify result from a dirty tree');
});

test('Evidence from an earlier Check attempt does not count', () => {
  const cwd = repo();
  const id = cleanCheck(cwd);
  force(cwd, id, { check_loops: 1 });
  refusesFinish(cwd, id, 'attempt 1 evidence in attempt 2');
});

test('an Accepted Check allows Finish at its head and stops counting once the head changes', () => {
  const cwd = repo();
  const id = cleanCheck(cwd);
  verdict(cwd, id, 'security', 'fail');
  refusesFinish(cwd, id, 'not yet accepted');
  assert.equal(accept(cwd, id, { findings: 'MEDIUM: x', decision: 'ship it, tracked in #9' }).status, 0);
  const { accepted } = read(cwd, id);
  assert.equal(accepted.head, head(cwd, id));
  assert.equal(accepted.decision, 'ship it, tracked in #9');
  assert.equal(accepted.findings, 'MEDIUM: x');
  assert.ok(Date.parse(accepted.at) > 0);
  commit(cwd, id);
  refusesFinish(cwd, id, 'accepted for another head');
  assert.equal(accept(cwd, id, { findings: 'MEDIUM: x', decision: 'still fine' }).status, 0);
  assert.equal(transition(cwd, id, 'finish').status, 0);
});

test('accept needs findings and a decision, Check, and a clean worktree', () => {
  const cwd = repo();
  const id = startRun(cwd);
  assert.notEqual(accept(cwd, id, { findings: 'x', decision: 'y' }).status, 0, 'not in Check');
  force(cwd, id, { stage: 'check' });
  assert.notEqual(accept(cwd, id, { findings: 'x' }).status, 0, 'no decision');
  assert.notEqual(accept(cwd, id, { decision: 'y' }).status, 0, 'no findings');
  assert.notEqual(accept(cwd, id, { findings: 'x', decision: 'y', head: 'forged' }).status, 0, 'extra field');
  writeFileSync(join(read(cwd, id).worktree, 'scratch.txt'), 'x');
  assert.notEqual(accept(cwd, id, { findings: 'x', decision: 'y' }).status, 0, 'dirty');
  assert.equal('accepted' in read(cwd, id), false);
  assert.notEqual(update(cwd, id, { accepted: { head: 'forged' } }).status, 0, 'not through update');
});

const inspect = (cwd, ...args) => run(cwd, 'inspect', '--json', ...args);
const problems = (cwd, id) => {
  const result = inspect(cwd);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).find((r) => r.id === id).problems.map((p) => p.code);
};

test('inspect reports nothing for a healthy Run', () => {
  const cwd = repo();
  const id = cleanCheck(cwd);
  assert.deepEqual(problems(cwd, id), []);
});

test('inspect reports an unreadable record and a lock left behind', () => {
  const cwd = repo();
  const id = startRun(cwd);
  mkdirSync(join(cwd, '.factory', 'runs', 'broken'));
  writeFileSync(join(cwd, '.factory', 'runs', 'broken', 'run.json'), '{');
  writeFileSync(join(cwd, '.factory', 'runs', `.lock-${createHash('sha256').update(id).digest('hex')}`), '');
  assert.deepEqual(problems(cwd, 'broken'), ['unreadable']);
  assert.deepEqual(problems(cwd, id), ['lock']);
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

test('inspect reports Evidence that no longer matches the head', () => {
  const cwd = repo();
  const id = cleanCheck(cwd);
  commit(cwd, id);
  assert.deepEqual(problems(cwd, id), ['stale-evidence']);
});

test('inspect leaves finished Runs without a worktree alone and changes nothing on disk', () => {
  const cwd = repo();
  const id = startRun(cwd);
  const finished = startRun(cwd);
  rmSync(read(cwd, finished).worktree, { recursive: true });
  force(cwd, finished, { status: 'done' });
  const snapshot = () => execFileSync('find', ['.factory/runs', '-type', 'f', '-exec', 'sha1sum', '{}', '+'], { cwd, encoding: 'utf8' });
  const before = snapshot();
  assert.deepEqual(problems(cwd, finished), []);
  assert.equal(snapshot(), before);
  const text = run(cwd, 'inspect', '--id', id);
  assert.equal(text.status, 0);
  assert.match(text.stdout, /no problems/i);
  assert.notEqual(run(cwd, 'inspect', '--id', 'missing').status, 0);
});
