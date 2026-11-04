import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git-repo.js';
import { startDashboard } from '../src/dashboard.js';
import { viewsOf } from './run-view.js';
import { waitUntil } from './wait-until.js';
import {
  run,
  ok,
  read,
  data,
  PR,
  checked,
  review,
  waiting,
  post,
  atLimit,
  grant,
} from './dashboard-actions-helpers.js';

/** @import { Run } from '../src/run-record.js' */

test('sync rebases the Run onto the moved origin and clears the Evidence', async () => {
  const { cwd, id, wt } = await checked();
  await review(cwd, id);
  writeFileSync(join(cwd, 'upstream.txt'), 'x\n');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'upstream');
  const dash = await startDashboard({ projectDir: cwd, port: 0 });
  try {
    assert.deepEqual(await post(dash, id, 'sync'), { status: 200, text: 'synced' });
    const record = read(cwd, id);
    assert.equal(record.base_sha, git(cwd, 'rev-parse', 'main'));
    assert.equal(record.verify, undefined);
    assert.ok(existsSync(join(wt, 'upstream.txt')));
  } finally {
    await dash.close();
  }
});

test('clean-up keeps a Run whose PR is not merged and removes one whose PR is merged', async () => {
  const { cwd, id, wt } = await checked();
  await review(cwd, id);
  ok(await run(cwd, 'transition', '--id', id, '--to', 'finish'));
  ok(await run(cwd, 'update', '--id', id, '--data', data({ pr: PR })));
  ok(await run(cwd, 'complete', '--id', id));
  const tip = git(wt, 'rev-parse', 'HEAD');
  let state = 'OPEN';
  const dash = await startDashboard({ projectDir: cwd, port: 0, prInfo: () => ({ state, head: tip }) });
  try {
    const kept = await post(dash, id, 'clean');
    assert.equal(kept.status, 409);
    assert.match(kept.text, /not merged/);
    assert.ok(existsSync(wt));
    state = 'MERGED';
    assert.deepEqual(await post(dash, id, 'clean'), { status: 200, text: 'cleaned' });
    assert.equal(existsSync(wt), false);
    assert.ok(existsSync(join(cwd, '.factory', 'runs', id, 'run.json')));
  } finally {
    await dash.close();
  }
});

test('the Dashboard grants an extra loop to a Run in Check that waits at its limit', async () => {
  const { cwd, id } = await atLimit();
  const dash = await startDashboard({ projectDir: cwd, port: 0 });
  try {
    assert.deepEqual(await grant(dash, id), { status: 200, text: 'granted' });
    const record = read(cwd, id);
    assert.equal(record.extra_loops, 1);
    assert.equal(record.status, 'running');
    const view = (await viewsOf(dash)).find((r) => r.id === id);
    assert.ok(view, 'the Run has a view');
    assert.deepEqual([view.loops, view.loopCap, view.waiting], [4, 5, false]);
    assert.ok(view.events.some((e) => e.type === 'extra-loop' && e.granted === 1 && e.limit === 5));
    // It is not waiting any more, so a second click needs a new wait.
    assert.equal((await grant(dash, id)).status, 409);
  } finally {
    await dash.close();
  }
});

test('the Dashboard answers another request while a git call of an action is still running', async () => {
  const { cwd, id } = await checked();
  // Git runs this hook when sync's fetch updates a ref; it holds the call until the test releases it.
  const started = join(cwd, 'hook-started');
  const release = join(cwd, 'hook-release');
  const hooks = join(cwd, 'slow-hooks');
  mkdirSync(hooks);
  writeFileSync(
    join(hooks, 'reference-transaction'),
    `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(started)}, '');
const end = Date.now() + 10000;
while (!fs.existsSync(${JSON.stringify(release)}) && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
`,
    { mode: 0o755 },
  );
  const dash = await startDashboard({ projectDir: cwd, port: 0 });
  try {
    git(cwd, 'config', 'core.hooksPath', hooks.replaceAll('\\', '/'));
    let settled = false;
    const syncing = post(dash, id, 'sync').finally(() => (settled = true));
    await waitUntil(() => existsSync(started), { message: 'the git call is running' });
    const other = await fetch(`${dash.url}/api/projects/${dash.projectId}/runs`);
    assert.equal(other.status, 200);
    assert.equal(settled, false, 'sync is still waiting for git when the other request is answered');
    writeFileSync(release, '');
    assert.deepEqual(await syncing, { status: 200, text: 'synced' });
  } finally {
    writeFileSync(release, '');
    await dash.close();
  }
});

test(
  'a failing rollback after a failed accept goes to stderr and the answer keeps the accept error',
  { skip: process.platform === 'win32' || process.getuid?.() === 0 },
  async () => {
    const { cwd, id, wt } = await checked();
    await review(cwd, id, 'fail');
    await waiting(cwd, id);
    writeFileSync(join(wt, 'dirty.txt'), 'x\n');
    // `git status` in the Run worktree runs this command; once the Run is running it makes the Run folder read-only, so the compensating update cannot be written (POSIX; a Windows folder stays writable).
    const folder = join(cwd, '.factory', 'runs', id);
    const breaker = join(cwd, 'break.js');
    writeFileSync(
      breaker,
      `const fs = require('node:fs');
if (JSON.parse(fs.readFileSync(${JSON.stringify(join(folder, 'run.json'))}, 'utf8')).status === 'running') fs.chmodSync(${JSON.stringify(folder)}, 0o555);
`,
    );
    git(wt, 'config', 'core.fsmonitor', `node ${JSON.stringify(breaker.replaceAll('\\', '/'))}`);
    const dash = await startDashboard({ projectDir: cwd, port: 0 });
    const lines = /** @type {string[]} */ ([]);
    const original = console.error;
    console.error = (...args) => void lines.push(args.join(' '));
    try {
      const stamp = (await viewsOf(dash)).find((r) => r.id === id)?.updated ?? '';
      const result = await post(dash, id, 'accept', stamp);
      assert.equal(result.status, 409);
      assert.match(result.text, /uncommitted changes/);
      const logged = lines.find((line) => line.includes('after a failed accept'));
      assert.ok(logged, lines.join('\n'));
      assert.match(logged, /EACCES/);
    } finally {
      console.error = original;
      chmodSync(folder, 0o755);
      await dash.close();
    }
  },
);
