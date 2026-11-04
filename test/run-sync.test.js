import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli as runCli } from './cli-runner.js';
import { git, repo } from './git-repo.js';
import { metricsOf } from './run-view.js';

/** @import { Run } from '../src/run-record.js' */

/**
 * @param {string} cwd
 * @param {...string} args
 */
const run = (cwd, ...args) => runCli(cwd, 'run', ...args);
/** @param {import('./cli-runner.js').CliResult} result */
const ok = (result) => {
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
/**
 * @param {string} cwd
 * @param {string} id
 * @returns {Run}
 */
const read = (cwd, id) => JSON.parse(readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8'));
/** @param {unknown} value */
const data = (value) => JSON.stringify(value);

// A Run in Check with a clean Check for its current head, on top of `origin` (the same repository).
async function checked() {
  const cwd = repo();
  git(cwd, 'config', 'user.name', 't');
  git(cwd, 'config', 'user.email', 't@t');
  writeFileSync(join(cwd, '.gitignore'), '.factory/\n');
  writeFileSync(join(cwd, 'shared.txt'), 'one\ntwo\nthree\n');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'shared');
  const id = ok(
    await run(cwd, 'start', '--data', data({ title: 'Sync', agent: 'claude', commands: 'true', conventions: [] })),
  );
  const wt = read(cwd, id).worktree;
  ok(
    await run(
      cwd,
      'update',
      '--id',
      id,
      '--data',
      data({ spec_link: 'docs/specs/x.md', tickets: ['1'], tickets_total: 1 }),
    ),
  );
  ok(await run(cwd, 'transition', '--id', id, '--to', 'build'));
  writeFileSync(join(wt, 'mine.txt'), 'mine\n');
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 'mine');
  ok(await run(cwd, 'update', '--id', id, '--data', data({ tickets_done: 1 })));
  ok(await run(cwd, 'transition', '--id', id, '--to', 'check'));
  return { cwd, id, wt };
}
/**
 * @param {string} cwd
 * @param {string} id
 */
const review = async (cwd, id) => {
  ok(await run(cwd, 'verify', '--id', id));
  for (const [axis, value] of [
    ['standards', 'pass'],
    ['spec', 'pass'],
    ['security', 'pass'],
    ['infrastructure', 'skipped'],
  ])
    ok(await run(cwd, 'verdict', '--id', id, '--axis', axis, '--value', value));
};
/**
 * @param {string} cwd
 * @param {string} file
 * @param {string} text
 * @param {string} message
 */
const advance = (cwd, file, text, message) => {
  writeFileSync(join(cwd, file), text);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
};

test('sync rebases onto the moved base, records it and clears the Evidence', async () => {
  const { cwd, id, wt } = await checked();
  await review(cwd, id);
  const before = read(cwd, id);
  advance(cwd, 'other.txt', 'other\n', 'other work');
  ok(await run(cwd, 'sync', '--id', id));
  const after = read(cwd, id);
  assert.equal(after.base_sha, git(cwd, 'rev-parse', 'main'));
  assert.equal(git(wt, 'rev-parse', 'HEAD~1'), after.base_sha);
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
  assert.equal(after.check_loops, 0);
  assert.deepEqual(metricsOf(after).verdicts, metricsOf(before).verdicts, 'observed Check history stays');
  assert.equal(after.title, before.title);
  assert.notEqual(
    (await run(cwd, 'transition', '--id', id, '--to', 'finish')).status,
    0,
    'cleared Evidence cannot authorize Finish',
  );
});

test('sync keeps the Evidence when the base has not moved', async () => {
  const { cwd, id } = await checked();
  await review(cwd, id);
  const before = read(cwd, id);
  ok(await run(cwd, 'sync', '--id', id));
  const after = read(cwd, id);
  for (const key of /** @type {const} */ (['standards', 'spec', 'security', 'infrastructure', 'verify', 'reviewed']))
    assert.deepEqual(after[key], before[key], key);
});

test('sync names the conflicting files and leaves the branch alone', async () => {
  const { cwd, id, wt } = await checked();
  writeFileSync(join(wt, 'shared.txt'), 'one\nmine\nthree\n');
  git(wt, 'commit', '-q', '-am', 'edit shared');
  advance(cwd, 'shared.txt', 'one\ntheirs\nthree\n', 'edit shared on main');
  const head = git(wt, 'rev-parse', 'HEAD');
  const result = await run(cwd, 'sync', '--id', id);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /conflicts in shared\.txt/);
  assert.equal(git(wt, 'rev-parse', 'HEAD'), head);
  assert.equal(git(wt, 'status', '--porcelain'), '');
});

test('sync does not touch a rebase the user left open', async () => {
  const { cwd, id, wt } = await checked();
  writeFileSync(join(wt, 'shared.txt'), 'one\nmine\nthree\n');
  git(wt, 'commit', '-q', '-am', 'edit shared');
  advance(cwd, 'shared.txt', 'one\ntheirs\nthree\n', 'edit shared on main');
  assert.throws(() => git(wt, 'rebase', git(cwd, 'rev-parse', 'main')));
  writeFileSync(join(wt, 'shared.txt'), 'one\nboth\nthree\n');
  git(wt, 'add', '-A');
  const refused = await run(cwd, 'sync', '--id', id);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /rebase is already in progress/);
  assert.equal(git(wt, 'diff', '--cached', '--name-only'), 'shared.txt');
});

test('sync refuses uncommitted changes and Runs outside Build and Check', async () => {
  const { cwd, id, wt } = await checked();
  writeFileSync(join(wt, 'dirty.txt'), 'x\n');
  assert.match((await run(cwd, 'sync', '--id', id)).stderr, /uncommitted/);
  const define = ok(
    await run(cwd, 'start', '--data', data({ title: 'Other', agent: 'claude', commands: 'true', conventions: [] })),
  );
  assert.match((await run(cwd, 'sync', '--id', define)).stderr, /Build or Check/);
});

test('Finish refuses a branch that conflicts with origin, even when accepted, and passes once it is resolved and reviewed again', async () => {
  const { cwd, id, wt } = await checked();
  writeFileSync(join(wt, 'shared.txt'), 'one\nmine\nthree\n');
  git(wt, 'commit', '-q', '-am', 'edit shared');
  advance(cwd, 'shared.txt', 'one\ntheirs\nthree\n', 'edit shared on main');
  await review(cwd, id);
  const refused = await run(cwd, 'transition', '--id', id, '--to', 'finish');
  assert.notEqual(refused.status, 0);
  assert.match(
    refused.stderr,
    /merges cleanly: the branch conflicts with origin's default branch in shared\.txt; run `tds-factory run sync`/,
  );
  assert.doesNotMatch(refused.stderr, /CONFLICT|Auto-merging/);
  assert.equal(read(cwd, id).stage, 'check');
  // An Accepted Check does not excuse the conflict.
  ok(await run(cwd, 'accept', '--id', id, '--data', data({ findings: 'none', decision: 'go' })));
  assert.match((await run(cwd, 'transition', '--id', id, '--to', 'finish')).stderr, /merges cleanly/);
  // Resolving it by hand and syncing again clears the gate once the Check is redone.
  assert.notEqual((await run(cwd, 'sync', '--id', id)).status, 0);
  assert.throws(() => git(wt, 'rebase', git(cwd, 'rev-parse', 'main')));
  writeFileSync(join(wt, 'shared.txt'), 'one\nmine\ntheirs\nthree\n');
  git(wt, 'add', '-A');
  git(wt, '-c', 'core.editor=true', 'rebase', '--continue');
  ok(await run(cwd, 'sync', '--id', id));
  await review(cwd, id);
  ok(await run(cwd, 'transition', '--id', id, '--to', 'finish'));
});

test('Finish accepts a branch whose base moved without a conflict, keeping the Evidence', async () => {
  const { cwd, id } = await checked();
  await review(cwd, id);
  advance(cwd, 'other.txt', 'other\n', 'other work');
  ok(await run(cwd, 'transition', '--id', id, '--to', 'finish'));
  assert.equal(read(cwd, id).stage, 'finish');
});
