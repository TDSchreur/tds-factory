import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openRunStore } from '../src/run-store.js';
import { git, repo } from './git-repo.js';

const start = { title: 'Example', agent: 'claude', commands: 'npm test', conventions: [] };
const PR = 'https://github.com/o/r/pull/1';
const cli = resolve('bin/tds-factory.js');
const branches = (main) => git(main, 'branch', '--format=%(refname:short)').split('\n');

// A Run with a recorded PR whose branch has one commit; `state` is what the injected lookup says about the PR.
function finished(main, state = 'MERGED') {
  const store = openRunStore(main);
  const id = store.start(start);
  const wt = join(main, '.factory', 'worktrees', id);
  git(wt, 'commit', '-q', '--allow-empty', '-m', 'work');
  const pr = `https://github.com/o/r/pull/${id.length}${Math.floor(Math.random() * 1e6)}`;
  store.update(id, { pr });
  const head = git(wt, 'rev-parse', 'HEAD');
  return { store, id, wt, head, pr, prState: () => ({ state, head }) };
}

test('clean removes the worktree and branch of a merged Run and keeps its record', () => {
  const main = repo();
  const { store, id, wt, prState } = finished(main);
  assert.deepEqual(store.clean(id, { prState }), { id, outcome: 'cleaned' });
  assert.ok(!existsSync(wt));
  assert.ok(!branches(main).includes(id));
  assert.ok(existsSync(join(main, '.factory', 'runs', id, 'run.json')));
  assert.equal(store.clean(id, { prState }).outcome, 'already clean');
});

test('clean keeps a Run whose PR is open, closed, unknown or missing', () => {
  for (const state of ['OPEN', 'CLOSED']) {
    const main = repo();
    const { store, id, wt, prState } = finished(main, state);
    const result = store.clean(id, { prState });
    assert.equal(result.outcome, 'kept');
    assert.match(result.reason, /not merged/);
    assert.ok(existsSync(wt));
    assert.ok(branches(main).includes(id));
  }
  const main = repo();
  const { store, id, wt } = finished(main);
  assert.match(store.clean(id, { prState: () => undefined }).reason, /PR state/);
  const noPr = openRunStore(main).start(start);
  assert.match(store.clean(noPr, { prState: () => assert.fail('no PR to look up') }).reason, /no PR/);
  assert.ok(existsSync(wt));
});

test('clean keeps a worktree with uncommitted changes, and a branch that moved past the merged PR', () => {
  const main = repo();
  const dirty = finished(main);
  writeFileSync(join(dirty.wt, 'scratch.txt'), 'x');
  const kept = dirty.store.clean(dirty.id, { prState: dirty.prState });
  assert.equal(kept.outcome, 'kept');
  assert.match(kept.reason, /uncommitted/);
  assert.ok(existsSync(dirty.wt));

  const moved = finished(main);
  git(moved.wt, 'commit', '-q', '--allow-empty', '-m', 'after the PR');
  const result = moved.store.clean(moved.id, { prState: moved.prState });
  assert.equal(result.outcome, 'kept');
  assert.match(result.reason, /not in the merged PR/);
  assert.ok(branches(main).includes(moved.id));
});

test('clean refuses to run from inside the worktree it would remove', () => {
  const main = repo();
  const { id, wt, prState } = finished(main);
  const result = openRunStore(wt).clean(id, { prState });
  assert.equal(result.outcome, 'kept');
  assert.match(result.reason, /main checkout/);
  assert.ok(existsSync(wt));
});

test('after clean, inspect reports no problems and the Run stays listed', async () => {
  const main = repo();
  const { store, id, prState } = finished(main);
  // Inspect only expects a worktree from a Run that is still going.
  const file = join(main, '.factory', 'runs', id, 'run.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), status: 'done' }));
  store.clean(id, { prState });
  assert.deepEqual((await store.inspect()).filter((r) => r.problems.length), []);
  assert.deepEqual((await store.list()).map((r) => r.id), [id]);
});

test('clean --all sweeps merged Runs and leaves the others', () => {
  const main = repo();
  const a = finished(main), b = finished(main, 'OPEN');
  const results = a.store.cleanAll({ prState: (url) => (url === a.pr ? { state: 'MERGED', head: a.head } : { state: 'OPEN', head: b.head }) });
  assert.deepEqual(results.map(({ id, outcome }) => [id, outcome]), [[a.id, 'cleaned'], [b.id, 'kept']]);
  assert.ok(!existsSync(a.wt) && existsSync(b.wt));
});

const runCli = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });

test('the CLI clean needs --id or --all, and reports a Run without a PR as kept', () => {
  const main = repo();
  const id = openRunStore(main).start(start);
  assert.match(runCli(main, 'clean', '--id', id).stdout, new RegExp(`kept ${id}: no PR`));
  const bare = runCli(main, 'clean');
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /--id.*--all/);
});

test('run complete tells the user how to clean up once the PR is merged', () => {
  const main = repo();
  const store = openRunStore(main);
  const id = store.start(start);
  const file = join(main, '.factory', 'runs', id, 'run.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), stage: 'finish', pr: PR }));
  const result = runCli(main, 'complete', '--id', id);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`tds-factory run clean --id ${id}`));
});
