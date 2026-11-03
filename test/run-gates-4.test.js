import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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
  defined,
  verify,
  accept,
  cleanCheck,
  refusesFinish,
  problems,
} from './run-gates-helpers.js';

/** @import { Run } from '../src/run-record.js' */

test('run update rejects fields that only a transition may change, and leaves the record unchanged', () => {
  const cwd = repo();
  const id = startRun(cwd);
  const before = read(cwd, id);
  for (const data of [
    { stage: 'build' },
    { check_loops: 1 },
    { standards: 'pass' },
    { spec: 'pass' },
    { security: 'pass' },
    { infrastructure: 'skipped' },
    { status: 'done' },
    { worktree: '/elsewhere' },
    { base_sha: 'abc' },
  ]) {
    const result = update(cwd, id, { ...data, activity: 'sneaky' });
    assert.notEqual(result.status, 0, json(data));
    assert.deepEqual(read(cwd, id), before, json(data));
  }
});

test('transitions follow Flow order and skipping a Stage is refused', () => {
  const cwd = repo();
  const id = defined(cwd);
  for (const to of ['prepare', 'check', 'finish', 'define', 'nonsense'])
    assert.notEqual(transition(cwd, id, to).status, 0, to);
  assert.equal(read(cwd, id).stage, 'define');
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

test('a failing Verify command is recorded with its exit code and fails the CLI', () => {
  const cwd = repo();
  const id = startRun(cwd, 'echo oops 1>&2 && exit 3');
  const result = verify(cwd, id);
  assert.notEqual(result.status, 0);
  const recorded = present(read(cwd, id).verify, 'Verify is recorded');
  assert.equal(recorded.exit_code, 3);
  assert.match(readFileSync(join(cwd, '.factory', 'runs', id, recorded.log), 'utf8'), /oops/);
});

test('a Verify result from an uncommitted tree is marked dirty', () => {
  const cwd = repo();
  const id = startRun(cwd, 'true');
  writeFileSync(join(read(cwd, id).worktree, 'scratch.txt'), 'x');
  assert.equal(verify(cwd, id).status, 0);
  assert.equal(read(cwd, id).verify?.dirty, true);
});

test('Build, Check and Finish need a usable Verify command, so a Run without one cannot progress', () => {
  const cwd = repo();
  const id = startRun(cwd, '');
  update(cwd, id, { spec_link: 'docs/specs/x.md', tickets: ['1'], tickets_total: 1, tickets_done: 1 });
  const refused = transition(cwd, id, 'build');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /usable Verify command/);
  assert.equal(read(cwd, id).stage, 'define');
  for (const [stage, to] of [
    ['build', 'check'],
    ['check', 'finish'],
  ]) {
    force(cwd, id, { stage, commands: ' ' });
    const result = transition(cwd, id, to);
    assert.match(result.stderr, /usable Verify command/, to);
    assert.equal(read(cwd, id).stage, stage);
  }
  force(cwd, id, { stage: 'define', commands: 'npm test' });
  assert.equal(transition(cwd, id, 'build').status, 0);
});

test('a clean Check with current Evidence reaches Finish, and the Run can be completed', () => {
  const cwd = repo();
  const id = cleanCheck(cwd);
  assert.equal(transition(cwd, id, 'finish').status, 0);
  assert.equal(read(cwd, id).stage, 'finish');
  update(cwd, id, { pr: 'https://github.com/o/r/pull/1' });
  assert.equal(run(cwd, 'complete', '--id', id).status, 0);
  assert.equal(read(cwd, id).status, 'done');
});

test('Evidence from an earlier Check attempt does not count', () => {
  const cwd = repo();
  const id = cleanCheck(cwd);
  force(cwd, id, { check_loops: 1 });
  refusesFinish(cwd, id, 'attempt 1 evidence in attempt 2');
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

test('inspect does not pass a hand-edited base_sha to git as an option, and reports an unreadable base', () => {
  const cwd = repo();
  const id = startRun(cwd);
  const target = join(cwd, 'written-by-git.txt');
  force(cwd, id, { base_sha: `--output=${target}` });
  assert.deepEqual(problems(cwd, id), ['worktree-unreadable']);
  assert.equal(existsSync(target), false, 'git must not have written the file');
  force(cwd, id, { base_sha: 'f'.repeat(40) });
  assert.deepEqual(problems(cwd, id), ['worktree-unreadable']);
});

test('the Verify command is set once, and Finish needs a Verify result from that command', () => {
  const cwd = repo();
  const id = cleanCheck(cwd);
  assert.notEqual(update(cwd, id, { commands: 'true' }).status, 0);
  force(cwd, id, { verify: { ...read(cwd, id).verify, command: 'something else' } });
  refusesFinish(cwd, id, 'Verify result from another command');
  const unanswered = startRun(cwd, '');
  assert.equal(update(cwd, unanswered, { commands: 'npm test' }).status, 0, "the user's answer fills an empty command");
  assert.notEqual(update(cwd, unanswered, { commands: 'true' }).status, 0);
});

test('verify does not write through a symlink planted as verify.log', () => {
  const cwd = repo();
  const id = startRun(cwd, 'echo hi');
  const target = join(cwd, 'precious.txt');
  writeFileSync(target, 'keep');
  symlinkSync(target, join(cwd, '.factory', 'runs', id, 'verify.log'));
  assert.equal(verify(cwd, id).status, 0);
  assert.equal(readFileSync(target, 'utf8'), 'keep');
});

test('run update sets tickets_total to the number of Ticket links, also when the list changes later', () => {
  const cwd = repo();
  const id = startRun(cwd);
  assert.equal(update(cwd, id, { tickets: ['1', '2', '3'] }).status, 0);
  assert.equal(read(cwd, id).tickets_total, 3);
  assert.equal(update(cwd, id, { tickets: ['1'] }).status, 0);
  assert.equal(read(cwd, id).tickets_total, 1);
  assert.equal(update(cwd, id, { tickets: ['1', '2'], tickets_total: 2 }).status, 0);
  assert.equal(read(cwd, id).tickets_total, 2);
});

test('run update refuses a list shorter than tickets_done', () => {
  const cwd = repo();
  const id = startRun(cwd);
  update(cwd, id, { tickets: ['1', '2'], tickets_done: 2 });
  const before = readFileSync(file(cwd, id), 'utf8');
  const stored = update(cwd, id, { tickets: ['1'] });
  assert.notEqual(stored.status, 0);
  assert.match(stored.stderr, /1 Tickets.*2 done|tickets_done \(2\)/);
  const together = update(cwd, id, { tickets: ['1', '2'], tickets_done: 3 });
  assert.notEqual(together.status, 0);
  assert.equal(readFileSync(file(cwd, id), 'utf8'), before);
  assert.equal(update(cwd, id, { tickets: ['1'], tickets_done: 1 }).status, 0);
});
