import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { git, repo } from './git-repo.js';

const cli = resolve('bin/tds-factory.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });
const ok = (result) => { assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const read = (cwd, id) => JSON.parse(readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8'));
const data = (value) => JSON.stringify(value);

// A Run in Check with a clean Check for its current head, on top of `origin` (the same repository).
function checked() {
  const cwd = repo();
  git(cwd, 'config', 'user.name', 't');
  git(cwd, 'config', 'user.email', 't@t');
  writeFileSync(join(cwd, '.gitignore'), '.factory/\n');
  writeFileSync(join(cwd, 'shared.txt'), 'one\ntwo\nthree\n');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'shared');
  const id = ok(run(cwd, 'start', '--data', data({ title: 'Sync', agent: 'claude', commands: 'true', conventions: [] })));
  const wt = read(cwd, id).worktree;
  ok(run(cwd, 'update', '--id', id, '--data', data({ spec_link: 'docs/specs/x.md', tickets: ['1'], tickets_total: 1 })));
  ok(run(cwd, 'transition', '--id', id, '--to', 'build'));
  writeFileSync(join(wt, 'mine.txt'), 'mine\n');
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 'mine');
  ok(run(cwd, 'update', '--id', id, '--data', data({ tickets_done: 1 })));
  ok(run(cwd, 'transition', '--id', id, '--to', 'check'));
  return { cwd, id, wt };
}
const review = (cwd, id) => {
  ok(run(cwd, 'verify', '--id', id));
  for (const [axis, value] of [['standards', 'pass'], ['spec', 'pass'], ['security', 'pass'], ['infrastructure', 'skipped']]) ok(run(cwd, 'verdict', '--id', id, '--axis', axis, '--value', value));
};
const advance = (cwd, file, text, message) => {
  writeFileSync(join(cwd, file), text);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
};

test('sync rebases onto the moved base, records it and clears the Evidence', () => {
  const { cwd, id, wt } = checked();
  review(cwd, id);
  advance(cwd, 'other.txt', 'other\n', 'other work');
  ok(run(cwd, 'sync', '--id', id));
  const after = read(cwd, id);
  assert.equal(after.base_sha, git(cwd, 'rev-parse', 'main'));
  assert.equal(git(wt, 'rev-parse', 'HEAD~1'), after.base_sha);
  for (const key of ['standards', 'spec', 'security', 'infrastructure', 'verify', 'reviewed']) assert.equal(key in after, false, key);
  assert.equal(after.check_loops, 0);
});

test('sync keeps the Evidence when the base has not moved', () => {
  const { cwd, id } = checked();
  review(cwd, id);
  ok(run(cwd, 'sync', '--id', id));
  assert.equal(read(cwd, id).security, 'pass');
});

test('sync names the conflicting files and leaves the branch alone', () => {
  const { cwd, id, wt } = checked();
  writeFileSync(join(wt, 'shared.txt'), 'one\nmine\nthree\n');
  git(wt, 'commit', '-q', '-am', 'edit shared');
  advance(cwd, 'shared.txt', 'one\ntheirs\nthree\n', 'edit shared on main');
  const head = git(wt, 'rev-parse', 'HEAD');
  const result = run(cwd, 'sync', '--id', id);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /conflicts in shared\.txt/);
  assert.equal(git(wt, 'rev-parse', 'HEAD'), head);
  assert.equal(git(wt, 'status', '--porcelain'), '');
});

test('sync refuses uncommitted changes and Runs outside Build and Check', () => {
  const { cwd, id, wt } = checked();
  writeFileSync(join(wt, 'dirty.txt'), 'x\n');
  assert.match(run(cwd, 'sync', '--id', id).stderr, /uncommitted/);
  const define = ok(run(cwd, 'start', '--data', data({ title: 'Other', agent: 'claude', commands: 'true', conventions: [] })));
  assert.match(run(cwd, 'sync', '--id', define).stderr, /Build or Check/);
});

test('Finish refuses a branch that conflicts with origin, and passes after sync resolves it', () => {
  const { cwd, id, wt } = checked();
  writeFileSync(join(wt, 'shared.txt'), 'one\nmine\nthree\n');
  git(wt, 'commit', '-q', '-am', 'edit shared');
  advance(cwd, 'shared.txt', 'one\ntheirs\nthree\n', 'edit shared on main');
  review(cwd, id);
  const refused = run(cwd, 'transition', '--id', id, '--to', 'finish');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /merges cleanly.*shared\.txt.*run sync/);
  assert.equal(read(cwd, id).stage, 'check');
});

test('Finish accepts a branch whose base moved without a conflict, keeping the Evidence', () => {
  const { cwd, id } = checked();
  review(cwd, id);
  advance(cwd, 'other.txt', 'other\n', 'other work');
  ok(run(cwd, 'transition', '--id', id, '--to', 'finish'));
  assert.equal(read(cwd, id).stage, 'finish');
});
