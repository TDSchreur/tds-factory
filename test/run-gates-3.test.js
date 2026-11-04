import { finishProblems } from '../src/evidence.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, repo } from './git-repo.js';
import { defined as present, metricsOf } from './run-view.js';
import {
  cli,
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
  ABANDON,
  verify,
  verdict,
  accept,
  commit,
  cleanCheck,
  refusesFinish,
  problems,
} from './run-gates-helpers.js';

/** @import { Run } from '../src/run-record.js' */

test('start records the base commit of the fetched origin default branch', async () => {
  const cwd = repo();
  git(cwd, 'commit', '-q', '--allow-empty', '-m', 'second');
  const id = await startRun(cwd);
  assert.equal(read(cwd, id).base_sha, git(cwd, 'rev-parse', 'main'));
});

test('an old-shaped record without the new fields still takes allowed updates', async () => {
  const cwd = repo();
  const dir = join(cwd, '.factory', 'runs', 'old');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), json({ stage: 'build', status: 'running', title: 'Old' }));
  assert.equal((await update(cwd, 'old', { activity: 'still here' })).status, 0);
  assert.equal(read(cwd, 'old').activity, 'still here');
});

test('a Run recorded at prepare is read as Define: it moves to Build only with a Spec and Tickets', async () => {
  const cwd = repo();
  const id = await startRun(cwd);
  force(cwd, id, { stage: 'prepare' });
  const refused = await transition(cwd, id, 'build');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Spec/);
  await update(cwd, id, { spec_link: 'docs/specs/x.md', tickets: ['1'], tickets_total: 1 });
  assert.equal((await transition(cwd, id, 'build')).status, 0);
  assert.equal(read(cwd, id).stage, 'build');
});

test('rework is the way back from Check: it counts the loop, clears Evidence and stops at the limit', async () => {
  const cwd = repo();
  const id = await defined(cwd);
  assert.notEqual((await run(cwd, 'rework', '--id', id)).status, 0, 'not in Check');
  force(cwd, id, {
    stage: 'check',
    tickets_done: 2,
    standards: 'fail',
    spec: 'pass',
    security: 'pass',
    infrastructure: 'skipped',
    verify: { exit_code: 0 },
    reviewed: { standards: { head: 'a', attempt: 1 } },
    accepted: { decision: 'ok' },
    project_results: { a11y: { head: 'a' } },
  });
  const before = read(cwd, id);
  assert.equal((await run(cwd, 'rework', '--id', id)).status, 0);
  const after = read(cwd, id);
  assert.equal(after.title, before.title);
  assert.deepEqual(metricsOf(after).verdicts, metricsOf(before).verdicts, 'observed Check history stays');
  assert.equal(after.stage, 'build');
  assert.equal(after.check_loops, 1);
  for (const key of [
    'standards',
    'spec',
    'security',
    'infrastructure',
    'verify',
    'reviewed',
    'accepted',
    'project_results',
  ])
    assert.equal(key in after, false, key);
  assert.ok(finishProblems(after, { head: 'a', dirty: false }).length > 0, 'cleared Evidence cannot authorize Finish');
  for (const loops of [2, 3]) {
    force(cwd, id, { stage: 'check', check_loops: loops });
    assert.equal((await run(cwd, 'rework', '--id', id)).status, 0, `loop ${loops + 1} of 4 is allowed`);
    assert.equal(read(cwd, id).check_loops, loops + 1);
  }
  force(cwd, id, { stage: 'check', check_loops: 4 });
  const refused = await run(cwd, 'rework', '--id', id);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Check loop limit of 4/);
  assert.equal(read(cwd, id).stage, 'check');
  assert.equal(read(cwd, id).check_loops, 4);
});

test('a passing verdict on an uncommitted tree is refused, a failing one is recorded', async () => {
  const cwd = repo();
  const id = await startRun(cwd);
  force(cwd, id, { stage: 'check' });
  writeFileSync(join(read(cwd, id).worktree, 'scratch.txt'), 'x');
  assert.notEqual((await verdict(cwd, id, 'security', 'pass')).status, 0);
  assert.equal('security' in read(cwd, id), false);
  assert.equal((await verdict(cwd, id, 'security', 'fail')).status, 0);
  assert.equal(read(cwd, id).security, 'fail');
});

test('an Accepted Check allows Finish at its head and stops counting once the head changes', async () => {
  const cwd = repo();
  const id = await cleanCheck(cwd);
  await verdict(cwd, id, 'security', 'fail');
  await refusesFinish(cwd, id, 'not yet accepted');
  assert.equal((await accept(cwd, id, { findings: 'MEDIUM: x', decision: 'ship it, tracked in #9' })).status, 0);
  const accepted = present(read(cwd, id).accepted, 'the acceptance is recorded');
  assert.equal(accepted.head, head(cwd, id));
  assert.equal(accepted.decision, 'ship it, tracked in #9');
  assert.equal(accepted.findings, 'MEDIUM: x');
  assert.ok(Date.parse(accepted.at ?? '') > 0);
  commit(cwd, id);
  await refusesFinish(cwd, id, 'accepted for another head');
  assert.equal((await accept(cwd, id, { findings: 'MEDIUM: x', decision: 'still fine' })).status, 0);
  assert.equal((await transition(cwd, id, 'finish')).status, 0);
});

test('inspect reports Evidence that no longer matches the head', async () => {
  const cwd = repo();
  const id = await cleanCheck(cwd);
  commit(cwd, id);
  assert.deepEqual(await problems(cwd, id), ['stale-evidence']);
});

test('inspect flags a project file renamed into docs/ while the Run is in Define', async () => {
  const cwd = repo();
  writeFileSync(join(cwd, 'code.js'), 'export const x = 1;\n'.repeat(20));
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'code');
  const id = await startRun(cwd);
  const wt = read(cwd, id).worktree;
  mkdirSync(join(wt, 'docs'), { recursive: true });
  git(wt, 'mv', 'code.js', 'docs/code.js');
  git(wt, 'commit', '-q', '-m', 'rename');
  assert.deepEqual(await problems(cwd, id), ['stage-skipped']);
});

test('Check needs at least one counted Ticket', async () => {
  const cwd = repo();
  const id = await startRun(cwd);
  await update(cwd, id, { spec_link: 'docs/specs/x.md', tickets: ['1'] });
  assert.equal((await transition(cwd, id, 'build')).status, 0);
  assert.notEqual((await transition(cwd, id, 'check')).status, 0);
});

test('a Verify result is not recorded for a Run that was stopped while the command ran', async () => {
  const cwd = repo();
  const id = await startRun(cwd, '');
  await update(cwd, id, {
    commands: `${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} run update --id ${id} --data ${process.platform === 'win32' ? JSON.stringify(ABANDON) : `'${ABANDON}'`}`,
  });
  assert.notEqual((await verify(cwd, id)).status, 0);
  assert.equal('verify' in read(cwd, id), false);
  assert.equal(read(cwd, id).status, 'abandoned');
});

test('Verify with a missing worktree records that verification is unavailable', async () => {
  const cwd = repo();
  const id = await startRun(cwd, 'true');
  git(cwd, 'worktree', 'remove', read(cwd, id).worktree);
  assert.notEqual((await verify(cwd, id)).status, 0);
  assert.equal(read(cwd, id).status, 'verification-unavailable');
  assert.match(read(cwd, id).status_reason ?? '', /worktree.*missing/);
});

test('run update refuses a tickets_total that does not match the list and leaves the record unchanged', async () => {
  const cwd = repo();
  const id = await startRun(cwd);
  await update(cwd, id, { tickets: ['1', '2'] });
  const before = readFileSync(file(cwd, id), 'utf8');
  for (const data of [{ tickets: ['1', '2'], tickets_total: 5 }, { tickets_total: 3 }]) {
    const result = await update(cwd, id, data);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tickets_total \(\d\) does not match the \d Tickets/);
  }
  assert.match(
    (await update(cwd, id, { tickets_total: 3 })).stderr,
    /tickets_total \(3\) does not match the 2 Tickets/,
  );
  assert.equal(readFileSync(file(cwd, id), 'utf8'), before);
});
