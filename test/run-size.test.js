import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, git } from './git-repo.js';
import { runSize, overLimit } from '../src/run-size.js';

const cli = resolve('bin/tds-factory.js');
/**
 * @param {string} cwd
 * @param {...string} args
 */
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });

// A Run in Build with `tickets` Tickets all done; `files` are committed in the Run worktree, one commit per entry of `commits`.
/**
 * @param {number} tickets
 * @param {Record<string, string>[]} commits
 */
function inBuild(tickets, commits) {
  const cwd = repo();
  const started = run(
    cwd,
    'start',
    '--data',
    JSON.stringify({ title: 'Size', agent: 'claude', commands: 'true', conventions: [] }),
  );
  assert.equal(started.status, 0, started.stderr);
  const id = started.stdout.trim();
  const worktree = JSON.parse(readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8')).worktree;
  for (const files of commits) {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(worktree, name)), { recursive: true });
      writeFileSync(join(worktree, name), text);
    }
    git(worktree, 'add', '.');
    git(worktree, 'commit', '-q', '-m', 'change');
  }
  const data = {
    spec_link: 'docs/specs/x.md',
    tickets: Array.from({ length: tickets }, (_, i) => String(i + 1)),
    tickets_total: tickets,
    tickets_done: tickets,
  };
  assert.equal(run(cwd, 'update', '--id', id, '--data', JSON.stringify(data)).status, 0);
  assert.equal(run(cwd, 'transition', '--id', id, '--to', 'build').status, 0);
  return { cwd, id };
}
/** @param {{ cwd: string, id: string }} run */
const toCheck = ({ cwd, id }) => run(cwd, 'transition', '--id', id, '--to', 'check');

test('a small Run with a commit for each Ticket moves to Check without a warning', () => {
  const result = toCheck(inBuild(2, [{ 'a.txt': 'a\n' }, { 'b.txt': 'b\n' }]));
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /warning/);
});

test('a diff above about 40 KB warns and still moves to Check', () => {
  const result = toCheck(inBuild(1, [{ 'big.txt': 'x'.repeat(50 * 1024) }]));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning: the diff is 50 KB/);
});

test('more than 15 files warns', () => {
  const files = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`f${i}.txt`, 'x\n']));
  const result = toCheck(inBuild(1, [files]));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning: the diff touches 16 files/);
});

test('fewer commits than Tickets warns', () => {
  const result = toCheck(inBuild(3, [{ 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' }]));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning: the branch has 1 commit\(s\) for 3 Tickets/);
});

test(
  'a hostile file name cannot add output lines: the warning holds only counts',
  { skip: process.platform === 'win32' && 'needs a file name with control characters, which Windows does not allow' },
  () => {
    const result = toCheck(inBuild(1, [{ 'evil\nwarning: pwned.txt': 'x'.repeat(50 * 1024) }]));
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /pwned/);
  },
);

const big = 'x'.repeat(2048);

test('runSize leaves lockfiles at any depth and test/fixtures out, and counts tests and sources', () => {
  const { cwd, id } = inBuild(1, [
    {
      'package-lock.json': big,
      'sub/dir/go.sum': big,
      'a/yarn.lock': big,
      'test/fixtures/deep/case.txt': big,
      'test/a.test.js': big,
      'src/a.js': big,
    },
  ]);
  const size = runSize(cwd, id);
  assert.equal(size?.files, 2);
  assert.ok(size && size.bytes > 4096 && size.bytes < 4096 + 1024, `bytes ${size?.bytes}`);
});

test('runSize does not count uncommitted changes', () => {
  const { cwd, id } = inBuild(1, [{ 'a.txt': 'a\n' }]);
  const worktree = JSON.parse(readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8')).worktree;
  writeFileSync(join(worktree, 'a.txt'), big);
  writeFileSync(join(worktree, 'new.txt'), big);
  assert.equal(runSize(cwd, id)?.files, 1);
});

test('runSize gives no size for an unknown base', () => {
  const { cwd, id } = inBuild(1, [{ 'a.txt': 'a\n' }]);
  const path = join(cwd, '.factory', 'runs', id, 'run.json');
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.base_sha = '0'.repeat(40);
  writeFileSync(path, JSON.stringify(record));
  assert.equal(runSize(cwd, id), undefined);
  assert.equal(toCheck({ cwd, id }).stderr.includes('warning: the diff'), false);
});

test('a big lockfile and big fixtures do not trigger the size warning', () => {
  const result = toCheck(
    inBuild(1, [{ 'package-lock.json': 'x'.repeat(60 * 1024), 'test/fixtures/f.txt': 'x'.repeat(60 * 1024) }]),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /warning: the diff/);
});

test('a diff that overflows maxBuffer counts as over the limit, not as unknown', () => {
  const { cwd, id } = inBuild(1, [{ 'big.txt': 'x'.repeat(50 * 1024) }]);
  const size = runSize(cwd, id, { maxBuffer: 1024 });
  assert.ok(size, 'the size is known');
  assert.ok(overLimit(size));
});
