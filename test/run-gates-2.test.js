import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, repo } from './git-repo.js';
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
  head,
  verify,
  verdict,
  cleanCheck,
  refusesFinish,
  problems,
} from './run-gates-helpers.js';

/** @import { Run } from '../src/run-record.js' */

test('a finished Run cannot change status through update, but still takes notes', async () => {
  const cwd = repo();
  const id = await startRun(cwd);
  for (const status of ['done', 'abandoned']) {
    writeFileSync(file(cwd, id), json({ ...read(cwd, id), status, waiting_on_human: false, waiting_reason: '' }));
    for (const next of ['running', 'waiting', 'abandoned'])
      assert.notEqual(
        (await update(cwd, id, { status: next, waiting_reason: next === 'waiting' ? 'x' : '' })).status,
        0,
        `${status} to ${next}`,
      );
    assert.equal(read(cwd, id).status, status);
    assert.equal((await update(cwd, id, { activity: 'PR merged' })).status, 0);
  }
});

test('a Run moves from Define straight to Build', async () => {
  const cwd = repo();
  const id = await defined(cwd);
  assert.equal((await transition(cwd, id, 'build')).status, 0);
  assert.equal(read(cwd, id).stage, 'build');
});

test('Check needs every counted Ticket done', async () => {
  const cwd = repo();
  const id = await defined(cwd);
  await transition(cwd, id, 'build');
  await update(cwd, id, { tickets_done: 1 });
  assert.notEqual((await transition(cwd, id, 'check')).status, 0);
  await update(cwd, id, { tickets_done: 2 });
  assert.equal((await transition(cwd, id, 'check')).status, 0);
  assert.equal(read(cwd, id).stage, 'check');
});

test('complete ends a Run only at Finish with a PR link and sane Ticket counts', async () => {
  const cwd = repo();
  const id = await defined(cwd);
  force(cwd, id, { stage: 'build', tickets_done: 2 });
  assert.notEqual((await run(cwd, 'complete', '--id', id)).status, 0, 'not at Finish');
  force(cwd, id, { stage: 'finish' });
  assert.notEqual((await run(cwd, 'complete', '--id', id)).status, 0, 'no PR link');
  await update(cwd, id, { pr: 'https://github.com/o/r/pull/1', tickets_done: 5 });
  assert.notEqual((await run(cwd, 'complete', '--id', id)).status, 0, 'more done than counted');
  await update(cwd, id, { tickets_done: 2 });
  assert.equal((await run(cwd, 'complete', '--id', id)).status, 0);
  assert.equal(read(cwd, id).status, 'done');
  assert.notEqual((await run(cwd, 'complete', '--id', id)).status, 0, 'already done');
});

test('verify refuses a Run with no Verify command, and verify results cannot be written by update', async () => {
  const cwd = repo();
  const id = await startRun(cwd, '');
  assert.notEqual((await verify(cwd, id)).status, 0);
  assert.equal('verify' in read(cwd, id), false);
  assert.notEqual((await update(cwd, id, { verify: { exit_code: 0 } })).status, 0);
});

test('verify refuses a blank Verify command found in the record', async () => {
  const cwd = repo();
  const id = await startRun(cwd);
  force(cwd, id, { commands: '   ' });
  assert.match((await verify(cwd, id)).stderr, /usable Verify command/);
});

test('a verdict is stamped with the head and the Check attempt', async () => {
  const cwd = repo();
  const id = await startRun(cwd);
  force(cwd, id, { stage: 'check' });
  assert.equal((await verdict(cwd, id, 'standards', 'pass')).status, 0);
  assert.equal(read(cwd, id).standards, 'pass');
  assert.deepEqual(read(cwd, id).reviewed?.standards, { head: head(cwd, id), attempt: 1 });
  force(cwd, id, { check_loops: 1 });
  assert.equal((await verdict(cwd, id, 'infrastructure', 'skipped')).status, 0);
  assert.equal(read(cwd, id).reviewed?.infrastructure?.attempt, 2);
});

test('Finish is refused with a failed axis, a missing verdict or a failed Verify result', async () => {
  const cwd = repo();
  let id = await cleanCheck(cwd);
  assert.equal((await verdict(cwd, id, 'security', 'fail')).status, 0);
  await refusesFinish(cwd, id, 'failed axis');
  id = await startRun(cwd);
  force(cwd, id, { stage: 'check' });
  await verify(cwd, id);
  await verdict(cwd, id, 'standards', 'pass');
  await refusesFinish(cwd, id, 'missing verdicts');
  id = await cleanCheck(cwd, 'exit 1');
  await refusesFinish(cwd, id, 'failed Verify');
  id = await cleanCheck(cwd);
  force(cwd, id, { verify: undefined });
  await refusesFinish(cwd, id, 'no Verify result');
});

test('inspect reports nothing for a healthy Run', async () => {
  const cwd = repo();
  const id = await cleanCheck(cwd);
  assert.deepEqual(await problems(cwd, id), []);
});

test('inspect reports an unreadable record and a lock left behind', async () => {
  const cwd = repo();
  const id = await startRun(cwd);
  mkdirSync(join(cwd, '.factory', 'runs', 'broken'));
  writeFileSync(join(cwd, '.factory', 'runs', 'broken', 'run.json'), '{');
  writeFileSync(join(cwd, '.factory', 'runs', `.lock-${createHash('sha256').update(id).digest('hex')}`), '');
  assert.deepEqual(await problems(cwd, 'broken'), ['unreadable']);
  assert.deepEqual(await problems(cwd, id), ['lock']);
});

test('inspect flags project code committed while the Run is still in Define, and not Define artifacts', async () => {
  const cwd = repo();
  const id = await startRun(cwd);
  const wt = read(cwd, id).worktree;
  mkdirSync(join(wt, 'docs', 'specs'), { recursive: true });
  writeFileSync(join(wt, 'docs', 'specs', 'x.md'), 'spec');
  writeFileSync(join(wt, 'GLOSSARY.md'), 'g');
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 'define artifacts');
  assert.deepEqual(await problems(cwd, id), []);
  writeFileSync(join(wt, 'code.js'), 'x');
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 'code without Build');
  assert.deepEqual(await problems(cwd, id), ['stage-skipped']);
  force(cwd, id, { stage: 'build' });
  assert.deepEqual(await problems(cwd, id), []);
});

test('inspect reports a running Run with no worktree and a finished Run with uncommitted changes', async () => {
  const cwd = repo();
  const old = await startRun(cwd);
  writeFileSync(file(cwd, old), json({ stage: 'build', status: 'running', title: 'Old' }));
  assert.deepEqual(await problems(cwd, old), ['worktree-missing']);
  const finished = await startRun(cwd);
  writeFileSync(join(read(cwd, finished).worktree, 'scratch.txt'), 'x');
  force(cwd, finished, { status: 'done' });
  assert.deepEqual(await problems(cwd, finished), ['worktree-dirty']);
});

test('paused Runs require a reason and resume without implying human waiting', async () => {
  const cwd = repo();
  const id = await startRun(cwd);
  for (const status of ['verification-unavailable', 'interrupted']) {
    assert.notEqual((await update(cwd, id, { status })).status, 0);
    assert.notEqual((await update(cwd, id, { status, status_reason: '  ' })).status, 0);
    assert.equal((await update(cwd, id, { status, status_reason: 'needs recovery' })).status, 0);
    assert.equal(read(cwd, id).waiting_on_human, false);
    assert.equal(read(cwd, id).status_reason, 'needs recovery');
    assert.notEqual((await transition(cwd, id, 'prepare')).status, 0);
    assert.equal((await update(cwd, id, { status: 'running' })).status, 0);
    assert.equal(read(cwd, id).status_reason, '');
  }
  assert.notEqual((await update(cwd, id, { status_reason: 'orphan reason' })).status, 0);
});

test('run update accepts tickets_total alone while there is no list', async () => {
  const cwd = repo();
  const id = await startRun(cwd);
  assert.equal((await update(cwd, id, { tickets_total: 4 })).status, 0);
  assert.equal(read(cwd, id).tickets_total, 4);
});
