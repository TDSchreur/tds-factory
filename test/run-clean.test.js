import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openRunStore } from '../src/run-store.js';
import { git, repo } from './git-repo.js';

const start = { title: 'Example', agent: 'claude', commands: 'npm test', conventions: [] };
const PR = 'https://github.com/o/r/pull/1';
const cli = resolve('bin/tds-factory.js');
const branches = (main) => git(main, 'branch', '--format=%(refname:short)').split('\n');

const setRecord = (main, id, change) => {
  const file = join(main, '.factory', 'runs', id, 'run.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), ...change }));
};
let prs = 0;

// A done Run with a recorded PR whose branch has one commit; `state` is what the injected lookup says about the PR.
function finished(main, state = 'MERGED') {
  const store = openRunStore(main);
  const id = store.start(start);
  const wt = join(main, '.factory', 'worktrees', id);
  git(wt, 'commit', '-q', '--allow-empty', '-m', 'work');
  const pr = `https://github.com/o/r/pull/${++prs}`;
  store.update(id, { pr });
  setRecord(main, id, { status: 'done' });
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

test('clean keeps a merged Run that is not done yet, and a branch that moves while GitHub is asked', () => {
  const main = repo();
  const going = finished(main);
  setRecord(main, going.id, { status: 'running' });
  assert.match(going.store.clean(going.id, { prState: going.prState }).reason, /run complete/);
  assert.ok(existsSync(going.wt));

  const racing = finished(main);
  const prState = () => {
    git(racing.wt, 'commit', '-q', '--allow-empty', '-m', 'late fix');
    return { state: 'MERGED', head: racing.head };
  };
  const result = racing.store.clean(racing.id, { prState });
  assert.equal(result.outcome, 'kept');
  assert.match(result.reason, /not in the merged PR/);
  assert.ok(existsSync(racing.wt) && branches(main).includes(racing.id));
});

test('clean from a subfolder of the Run worktree is refused, also when the folder name starts with two dots', () => {
  const main = repo();
  const { id, wt, prState } = finished(main);
  mkdirSync(join(wt, '..notes'));
  assert.match(openRunStore(join(wt, '..notes')).clean(id, { prState }).reason, /main checkout/);
});

test('clean removes a clean worktree that has an initialised submodule', () => {
  const sub = repo();
  git(sub, 'commit', '-q', '--allow-empty', '-m', 'second');
  const main = repo();
  git(main, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'vendor');
  git(main, 'commit', '-q', '-m', 'add submodule');
  const { id, wt, store, prState } = finished(main);
  git(wt, '-c', 'protocol.file.allow=always', 'submodule', 'update', '--init', '-q');
  assert.equal(store.clean(id, { prState }).outcome, 'cleaned');
  assert.ok(!existsSync(wt) && !branches(main).includes(id));
  // A dirty submodule still keeps the worktree.
  const dirty = finished(main);
  git(dirty.wt, '-c', 'protocol.file.allow=always', 'submodule', 'update', '--init', '-q');
  writeFileSync(join(dirty.wt, 'vendor', 'new.txt'), 'x');
  assert.match(dirty.store.clean(dirty.id, { prState: dirty.prState }).reason, /uncommitted/);
  assert.ok(existsSync(dirty.wt));
});

test('clean keeps a worktree whose submodule holds a commit or stash that exists nowhere else', () => {
  const sub = repo();
  git(sub, 'commit', '-q', '--allow-empty', '-m', 'second');
  const main = repo();
  git(main, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'vendor');
  git(main, 'commit', '-q', '-m', 'add submodule');
  for (const local of ['commit', 'stash']) {
    const { id, wt, store } = finished(main);
    git(wt, '-c', 'protocol.file.allow=always', 'submodule', 'update', '--init', '-q');
    if (local === 'commit') {
      git(join(wt, 'vendor'), 'commit', '-q', '--allow-empty', '-m', 'only here');
      git(wt, 'commit', '-q', '-am', 'bump the submodule');
    } else {
      writeFileSync(join(wt, 'vendor', 'tracked.txt'), 'x');
      git(join(wt, 'vendor'), 'add', 'tracked.txt');
      git(join(wt, 'vendor'), 'stash', '-q');
    }
    const head = git(wt, 'rev-parse', 'HEAD');
    const result = store.clean(id, { prState: () => ({ state: 'MERGED', head }) });
    assert.equal(result.outcome, 'kept', local);
    assert.match(result.reason, /submodule/);
    assert.ok(existsSync(wt) && branches(main).includes(id));
  }
});

test('clean keeps a Run whose record does not name the worktree this store made, and tolerates a project with no Runs', () => {
  const main = repo();
  const { id, store, prState } = finished(main);
  setRecord(main, id, { worktree: join(main, 'elsewhere') });
  assert.match(store.clean(id, { prState }).reason, /does not name the worktree this store created/);
  assert.deepEqual(openRunStore(repo()).cleanAll({ prState }), []);
});

test('clean keeps a branch that is checked out in another worktree', () => {
  const main = repo();
  const { id, wt, prState, store } = finished(main);
  git(main, 'worktree', 'remove', '--force', wt);
  git(main, 'checkout', '-q', id);
  const result = store.clean(id, { prState });
  assert.equal(result.outcome, 'kept');
  assert.match(result.reason, /checked out/);
  assert.ok(branches(main).includes(id));
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
  store.clean(id, { prState });
  assert.deepEqual(
    (await store.inspect()).filter((r) => r.problems.length),
    [],
  );
  assert.deepEqual(
    (await store.list()).map((r) => r.id),
    [id],
  );
});

test('clean --all sweeps merged Runs and leaves the others', () => {
  const main = repo();
  const a = finished(main),
    b = finished(main, 'OPEN');
  const noPr = openRunStore(main).start(start);
  const results = a.store.cleanAll({
    prState: (url) => (url === a.pr ? { state: 'MERGED', head: a.head } : { state: 'OPEN', head: b.head }),
  });
  assert.deepEqual(
    results.map(({ id, outcome }) => [id, outcome]),
    [
      [a.id, 'cleaned'],
      [b.id, 'kept'],
    ],
    `${noPr} has no PR and is not listed`,
  );
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
  assert.match(runCli(main, 'clean', '--id', id, '--all').stderr, /not both/);
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

test('clean works for a merged Azure DevOps PR through the provider seam, and keeps a Run whose PR is still open', async () => {
  const { providerFor } = await import('../src/pr-provider.js');
  const recorded = (key) =>
    JSON.parse(readFileSync(new URL(`./fixtures/pr-status/azure/${key}.pr.json`, import.meta.url), 'utf8'));
  for (const [key, outcome] of [
    ['completed', 'cleaned'],
    ['passing', 'kept'],
  ]) {
    const main = repo();
    const { store, id, wt, head } = finished(main);
    const pr = `https://dev.azure.com/example-org/Projects/_git/Kahoot/pullrequest/${recorded(key).pullRequestId}`;
    store.update(id, { pr });
    // What the default lookup does for a Run: ask the adapter of the PR link for state and head (here from the recorded answer, with the head of this branch).
    const answer = { ...recorded(key), lastMergeSourceCommit: { commitId: head } };
    const prState = (url) => {
      const { state, headRefOid } = providerFor(url).view(url, {
        run: () => ({ status: 0, stdout: JSON.stringify(answer) }),
      });
      return { state, head: headRefOid };
    };
    const result = store.clean(id, { prState });
    assert.equal(result.outcome, outcome, key);
    assert.equal(existsSync(wt), outcome === 'kept', key);
  }
});
