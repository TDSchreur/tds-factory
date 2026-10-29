import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
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

test('start from a linked worktree creates a separate worktree from the latest origin default branch', () => {
  const origin = repo();
  const clone = join(mkdtempSync(join(tmpdir(), 'run-worktrees-clone-')), 'c');
  git(origin, 'clone', '-q', origin, clone);
  const wt = linked(clone);
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'new origin commit');
  const id = openRunStore(wt).start(start);
  assert.notEqual(record(clone, id).worktree, wt);
  assert.equal(git(record(clone, id).worktree, 'rev-parse', 'HEAD'), git(origin, 'rev-parse', 'HEAD'));
});

test('start uses the current origin default branch when it changed after cloning', () => {
  const origin = repo();
  const clone = join(mkdtempSync(join(tmpdir(), 'run-worktrees-clone-')), 'c');
  git(origin, 'clone', '-q', origin, clone);
  git(origin, 'switch', '-q', '-c', 'new-default');
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'new default');
  const id = openRunStore(clone).start(start);
  assert.equal(git(record(clone, id).worktree, 'rev-parse', 'HEAD'), git(origin, 'rev-parse', 'HEAD'));
});

test('start fails when origin has no discoverable default branch', () => {
  const origin = repo();
  const clone = join(mkdtempSync(join(tmpdir(), 'run-worktrees-clone-')), 'c');
  git(origin, 'clone', '-q', origin, clone);
  git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/missing');
  assert.throws(() => openRunStore(clone).start(start), /origin default branch/);
  assert.ok(!existsSync(join(clone, '.factory', 'runs')) || readdirSync(join(clone, '.factory', 'runs')).length === 0);
});

test('start fails without an accessible origin and leaves no Run', () => {
  const main = repo();
  git(main, 'remote', 'remove', 'origin');
  assert.throws(() => openRunStore(main).start(start), /origin/);
  assert.ok(!existsSync(join(main, '.factory', 'runs')) || readdirSync(join(main, '.factory', 'runs')).length === 0);
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

// Fixture: only run complete ends a Run, and it needs a PR, so write the finished record directly.
const finish = (store, id) => {
  const file = join(store.projectDir, '.factory', 'runs', id, 'run.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), status: 'done' }));
};

test('remove deletes the Run folder and a clean worktree but keeps the branch', () => {
  const main = repo();
  const store = openRunStore(main);
  const id = store.start(start);
  const { worktree } = record(main, id);
  finish(store, id);
  assert.equal(store.remove(id), 'deleted');
  assert.ok(!existsSync(worktree) && !existsSync(join(main, '.factory', 'runs', id)));
  assert.ok(branches(main).includes(id));
});

test('remove refuses a worktree with uncommitted changes and keeps the history', () => {
  const main = repo();
  const store = openRunStore(main);
  const id = store.start(start);
  const { worktree } = record(main, id);
  writeFileSync(join(worktree, 'unsaved.txt'), 'work in progress');
  finish(store, id);
  assert.equal(store.remove(id), 'worktree-refused');
  assert.ok(existsSync(join(worktree, 'unsaved.txt')) && existsSync(join(main, '.factory', 'runs', id, 'run.json')));
});

test('remove leaves an adopted worktree alone', () => {
  const main = repo();
  const wt = linked(main);
  const store = openRunStore(wt);
  const id = store.start(start);
  const file = join(main, '.factory', 'runs', id, 'run.json');
  const old = record(main, id);
  writeFileSync(file, JSON.stringify({ ...old, worktree: wt }));
  finish(store, id);
  assert.equal(store.remove(id), 'deleted');
  assert.ok(existsSync(wt));
});

test('the Dashboard reports a refused worktree removal and keeps the Run', async () => {
  const main = repo();
  const store = openRunStore(main);
  const id = store.start(start);
  writeFileSync(join(record(main, id).worktree, 'unsaved.txt'), 'work in progress');
  finish(store, id);
  const dashboard = await startDashboard({ projectDir: main, port: 0 });
  try {
    const res = await fetch(`${dashboard.url}/api/runs/${id}`, { method: 'DELETE', headers: { Origin: dashboard.url } });
    assert.equal(res.status, 409);
    assert.match(await res.text(), /uncommitted changes/);
    assert.deepEqual((await (await fetch(`${dashboard.url}/api/runs`)).json()).map((r) => r.id), [id]);
  } finally {
    await dashboard.close();
  }
});

test('start and update from a subfolder of the main checkout use the main checkout Run store', () => {
  const main = repo();
  const sub = join(main, 'sub');
  mkdirSync(sub);
  const id = openRunStore(sub).start(start);
  assert.ok(existsSync(join(main, '.factory', 'runs', id, 'run.json')));
  assert.equal(record(main, id).worktree, join(main, '.factory', 'worktrees', id));
  assert.ok(!existsSync(join(sub, '.factory')));
});

test('a Run restarted after its history was deleted gets a fresh id, because the branch is kept', () => {
  const main = repo();
  const store = openRunStore(main);
  const first = store.start(start);
  finish(store, first);
  assert.equal(store.remove(first), 'deleted');
  const second = store.start(start);
  assert.notEqual(second, first);
  assert.ok(branches(main).includes(first) && branches(main).includes(second));
});

test('a branch the user already made with the Run id does not block start', () => {
  const main = repo();
  const taken = `${new Date().toISOString().slice(0, 10)}-example`;
  git(main, 'branch', taken);
  const id = openRunStore(main).start(start);
  assert.notEqual(id, taken);
  assert.equal(git(record(main, id).worktree, 'branch', '--show-current'), id);
});


test('start rolls back the new worktree and branch if the record cannot be persisted', () => {
  const main = repo();
  const rename = fs.renameSync;
  fs.renameSync = (...args) => { if (args[1].endsWith('/run.json')) throw new Error('simulated record write failure'); return rename(...args); };
  try { assert.throws(() => openRunStore(main).start(start), /simulated record write failure/); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(branches(main), ['main']);
  assert.equal(git(main, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 1);
  assert.deepEqual(readdirSync(join(main, '.factory', 'runs')), []);
});

test('failed start keeps a dirty worktree and names the original and rollback failures', () => {
  const main = repo();
  const rename = fs.renameSync;
  fs.renameSync = (...args) => {
    if (args[1].endsWith('/run.json')) {
      const id = args[1].split('/').at(-2);
      writeFileSync(join(main, '.factory', 'worktrees', id, 'unfinished'), 'keep me');
      throw new Error('simulated record write failure');
    }
    return rename(...args);
  };
  try { assert.throws(() => openRunStore(main).start(start), /simulated record write failure; rollback failed: worktree remains/); }
  finally { fs.renameSync = rename; }
  const branch = branches(main).find((b) => b !== 'main');
  assert.equal(readFileSync(join(main, '.factory', 'worktrees', branch, 'unfinished'), 'utf8'), 'keep me');
});
