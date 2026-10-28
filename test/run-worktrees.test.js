import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { openRunStore } from '../src/run-store.js';
import { startDashboard } from '../src/dashboard.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
// A real git repository with one commit, plus a linked worktree of it.
function repo() {
  const main = realpathSync(mkdtempSync(join(tmpdir(), 'run-worktrees-')));
  git(main, 'init', '-q', '-b', 'main');
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  return main;
}
function linked(main) {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'run-worktrees-linked-'))), 'wt');
  git(main, 'worktree', 'add', '-q', '-b', 'side', dir);
  return dir;
}
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
