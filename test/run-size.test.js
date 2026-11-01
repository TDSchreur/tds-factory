import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, git } from './git-repo.js';

const cli = resolve('bin/tds-factory.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });

// A Run in Build with `tickets` Tickets all done; `files` are committed in the Run worktree, one commit per entry of `commits`.
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

test('a hostile file name cannot add output lines: the warning holds only counts', () => {
  const result = toCheck(inBuild(1, [{ 'evil\nwarning: pwned.txt': 'x'.repeat(50 * 1024) }]));
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /pwned/);
});
