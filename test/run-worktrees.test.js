import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openRunStore } from '../src/run-store.js';
import { startDashboard } from '../src/dashboard.js';
import { git, repo, linked } from './git-repo.js';

const start = { title: 'Example', agent: 'claude', commands: 'npm test', conventions: [] };
const cli = resolve('bin/tds-factory.js');
const runCli = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });

test('start and update from a linked worktree use the main checkout Run store', () => {
  const main = repo();
  const wt = linked(main);
  const id = openRunStore(wt).start(start);
  assert.ok(existsSync(join(main, '.factory', 'runs', id, 'run.json')));
  assert.ok(!existsSync(join(wt, '.factory')));
  openRunStore(wt).update(id, { activity: 'from the worktree' });
  assert.equal(JSON.parse(readFileSync(join(main, '.factory', 'runs', id, 'run.json'))).activity, 'from the worktree');
});

test('the CLI from a linked worktree writes to the main checkout Run store', () => {
  const main = repo();
  const wt = linked(main);
  const result = runCli(wt, 'start', '--data', JSON.stringify(start));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(main, '.factory', 'runs', result.stdout.trim(), 'run.json')));
});

test('a Dashboard in the main checkout lists a Run created from a worktree', async () => {
  const main = repo();
  const id = openRunStore(linked(main)).start(start);
  const dashboard = await startDashboard({ projectDir: main, port: 0 });
  try {
    const runs = await (await fetch(`${dashboard.url}/api/runs`)).json();
    assert.deepEqual(runs.map((r) => r.id), [id]);
  } finally {
    await dashboard.close();
  }
});

test('a plain checkout keeps its own Run store', () => {
  const main = repo();
  const id = openRunStore(main).start(start);
  assert.ok(existsSync(join(main, '.factory', 'runs', id, 'run.json')));
});

const record = (main, id) => JSON.parse(readFileSync(join(main, '.factory', 'runs', id, 'run.json')));
const branches = (main) => git(main, 'branch', '--format=%(refname:short)').split('\n');

test('start creates a Run worktree and a branch named after the Run id', () => {
  const main = repo();
  const id = openRunStore(main).start(start);
  const worktree = join(main, '.factory', 'worktrees', id);
  assert.equal(record(main, id).worktree, worktree);
  assert.equal(git(worktree, 'branch', '--show-current'), id);
  assert.equal(git(main, 'branch', '--show-current'), 'main');
});

test('two starts with the same title get separate worktrees and branches', () => {
  const main = repo();
  const [a, b] = [openRunStore(main).start(start), openRunStore(main).start(start)];
  assert.notEqual(a, b);
  assert.ok(existsSync(record(main, a).worktree) && existsSync(record(main, b).worktree));
  assert.ok(branches(main).includes(a) && branches(main).includes(b));
});

test('start cuts the branch from the default branch, not the checked-out one', () => {
  const origin = repo();
  const clone = join(mkdtempSync(join(tmpdir(), 'run-worktrees-clone-')), 'c');
  git(origin, 'clone', '-q', origin, clone);
  git(clone, 'switch', '-q', '-c', 'feature');
  git(clone, 'commit', '-q', '--allow-empty', '-m', 'feature work');
  const id = openRunStore(clone).start(start);
  assert.equal(git(clone, 'rev-parse', id), git(origin, 'rev-parse', 'main'));
});

test('start from a linked worktree adopts it and creates no worktree or branch', () => {
  const main = repo();
  const wt = linked(main);
  const id = openRunStore(wt).start(start);
  assert.equal(record(main, id).worktree, wt);
  assert.ok(!existsSync(join(main, '.factory', 'worktrees')));
  assert.deepEqual(branches(main).sort(), ['main', 'side']);
});

test('start fails clearly outside a git repository and in a repository with no commits', () => {
  const plain = mkdtempSync(join(tmpdir(), 'run-worktrees-plain-'));
  assert.throws(() => openRunStore(plain).start(start), /git repository/);
  assert.ok(!existsSync(join(plain, '.factory')));
  const empty = mkdtempSync(join(tmpdir(), 'run-worktrees-empty-'));
  git(empty, 'init', '-q');
  assert.throws(() => openRunStore(empty).start(start), /commit/);
  assert.ok(!existsSync(join(empty, '.factory', 'runs')) || readdirSync(join(empty, '.factory', 'runs')).length === 0);
});

test('the CLI start in a non-git directory exits non-zero with the message', () => {
  const result = runCli(mkdtempSync(join(tmpdir(), 'run-worktrees-plain-')), 'start', '--data', JSON.stringify(start));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /git repository/);
});
