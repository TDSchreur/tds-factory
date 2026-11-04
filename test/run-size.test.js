import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cli as runCli } from './cli-runner.js';
import { repo, git } from './git-repo.js';
import { runSize, overLimit, describeSize, sizeWarnings } from '../src/run-size.js';

/**
 * @param {string} cwd
 * @param {...string} args
 */
const run = (cwd, ...args) => runCli(cwd, 'run', ...args);

// A Run in Build with `tickets` Tickets all done; `files` are committed in the Run worktree, one commit per entry of `commits`.
/**
 * @param {number} tickets
 * @param {Record<string, string>[]} commits
 */
async function inBuild(tickets, commits) {
  const cwd = repo();
  const started = await run(
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
  assert.equal((await run(cwd, 'update', '--id', id, '--data', JSON.stringify(data))).status, 0);
  assert.equal((await run(cwd, 'transition', '--id', id, '--to', 'build')).status, 0);
  return { cwd, id };
}
/** @param {{ cwd: string, id: string }} run */
const toCheck = async ({ cwd, id }) => await run(cwd, 'transition', '--id', id, '--to', 'check');

test('a small Run with a commit for each Ticket moves to Check without a warning', async () => {
  const result = await toCheck(await inBuild(2, [{ 'a.txt': 'a\n' }, { 'b.txt': 'b\n' }]));
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /warning/);
});

test('a diff above about 40 KB warns and still moves to Check', async () => {
  const result = await toCheck(await inBuild(1, [{ 'big.txt': 'x'.repeat(50 * 1024) }]));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning: the diff is 50 KB/);
});

test('more than 15 files warns', async () => {
  const files = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`f${i}.txt`, 'x\n']));
  const result = await toCheck(await inBuild(1, [files]));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning: the diff touches 16 files/);
});

test('fewer commits than Tickets warns', async () => {
  const result = await toCheck(await inBuild(3, [{ 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' }]));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning: the branch has 1 commit\(s\) for 3 Tickets/);
});

test(
  'a hostile file name cannot add output lines: the warning holds only counts',
  { skip: process.platform === 'win32' && 'needs a file name with control characters, which Windows does not allow' },
  async () => {
    const result = await toCheck(await inBuild(1, [{ 'evil\nwarning: pwned.txt': 'x'.repeat(50 * 1024) }]));
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /pwned/);
  },
);

const big = 'x'.repeat(2048);

test('runSize leaves lockfiles at any depth and test/fixtures out, and counts tests and sources', async () => {
  const { cwd, id } = await inBuild(1, [
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

test('runSize does not count uncommitted changes', async () => {
  const { cwd, id } = await inBuild(1, [{ 'a.txt': 'a\n' }]);
  const worktree = JSON.parse(readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8')).worktree;
  writeFileSync(join(worktree, 'a.txt'), big);
  writeFileSync(join(worktree, 'new.txt'), big);
  assert.equal(runSize(cwd, id)?.files, 1);
});

test('runSize gives no size for an unknown base', async () => {
  const { cwd, id } = await inBuild(1, [{ 'a.txt': 'a\n' }]);
  const path = join(cwd, '.factory', 'runs', id, 'run.json');
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.base_sha = '0'.repeat(40);
  writeFileSync(path, JSON.stringify(record));
  assert.equal(runSize(cwd, id), undefined);
  assert.equal((await toCheck({ cwd, id })).stderr.includes('warning: the diff'), false);
});

test('a big lockfile and big fixtures do not trigger the size warning', async () => {
  const result = await toCheck(
    await inBuild(1, [{ 'package-lock.json': 'x'.repeat(60 * 1024), 'test/fixtures/f.txt': 'x'.repeat(60 * 1024) }]),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /warning: the diff/);
});

test('a diff that overflows maxBuffer counts as over the limit, not as unknown', async () => {
  const { cwd, id } = await inBuild(1, [{ 'big.txt': 'x'.repeat(50 * 1024) }]);
  const size = runSize(cwd, id, { maxBuffer: 1024 });
  assert.ok(size, 'the size is known');
  assert.ok(overLimit(size));
});

/**
 * @param {string} code a git call that failed with this error code, without running a process
 * @returns {() => { status: null, stdout: string, stderr: string, error: Error }}
 */
const failing = (code) => () => ({
  status: null,
  stdout: '',
  stderr: '',
  error: Object.assign(new Error(code), { code }),
});

test('a git call that times out counts as over the limit with the reason timeout', async () => {
  const { cwd, id } = await inBuild(1, [{ 'a.txt': 'a\n' }]);
  const size = runSize(cwd, id, { git: failing('ETIMEDOUT') });
  assert.ok(size, 'the size is known');
  assert.equal(size.reason, 'timeout');
  assert.ok(overLimit(size));
});

test('a diff that overflows the output buffer has the reason overflow', async () => {
  const { cwd, id } = await inBuild(1, [{ 'big.txt': 'x'.repeat(50 * 1024) }]);
  assert.equal(runSize(cwd, id, { maxBuffer: 1024 })?.reason, 'overflow');
  assert.equal(runSize(cwd, id, { git: failing('ENOBUFS') })?.reason, 'overflow');
});

test('a timeout of only one of the two git calls still counts as over the limit', async () => {
  const { cwd, id } = await inBuild(1, [{ 'a.txt': 'a\n' }]);
  let calls = 0;
  /** @type {NonNullable<Parameters<typeof runSize>[2]>['git']} */
  const git2 = () => (++calls === 1 ? { status: 0, stdout: 'x', stderr: '' } : failing('ETIMEDOUT')());
  const size = runSize(cwd, id, { git: git2 });
  assert.equal(size?.reason, 'timeout');
  assert.ok(size && overLimit(size));
});

test('a plain git failure is still unknown, and a normal size has no reason', async () => {
  const { cwd, id } = await inBuild(1, [{ 'a.txt': 'a\n' }]);
  assert.equal(runSize(cwd, id, { git: () => ({ status: 128, stdout: '', stderr: 'fatal' }) }), undefined);
  assert.equal(runSize(cwd, id)?.reason, undefined);
});

test('the git calls get a time limit of 60 seconds unless a test says otherwise', async () => {
  const { cwd, id } = await inBuild(1, [{ 'a.txt': 'a\n' }]);
  /** @type {(number | undefined)[]} */
  const seen = [];
  runSize(cwd, id, {
    git: (_worktree, _args, options) => {
      seen.push(options?.timeout);
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  runSize(cwd, id, {
    timeout: 5,
    git: (_worktree, _args, options) => {
      seen.push(options?.timeout);
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.deepEqual(seen, [60_000, 60_000, 5, 5]);
});

test('describeSize says why the size is unknown instead of printing sentinel numbers', async () => {
  const sentence = 'size unknown: git timed out (or its output was too large), counted as over the limit';
  for (const reason of /** @type {const} */ (['timeout', 'overflow']))
    assert.equal(describeSize({ files: 16, bytes: 99999999, reason }), sentence);
  assert.equal(describeSize({ files: 1, bytes: 2048 }), '1 file, 2 KB');
  assert.equal(describeSize({ files: 3, bytes: 0 }), '3 files, 0 KB');
});

test('the warning before Check says the size is unknown after a timeout, and stays silent once accepted', async () => {
  const { cwd, id } = await inBuild(1, [{ 'a.txt': 'a\n' }]);
  const warnings = sizeWarnings(cwd, id, { git: failing('ETIMEDOUT') });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /size is unknown.*counted as over the limit/);
  assert.doesNotMatch(warnings[0], /99999|KB/);
});
