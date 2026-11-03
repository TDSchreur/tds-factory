import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { git, repo } from './git-repo.js';
import { writeHeaders } from './dashboard-token.js';
import { startDashboard } from '../src/dashboard.js';
import { ghPrInfoAsync } from '../src/run-clean.js';
import { viewsOf } from './run-view.js';
import { waitUntil } from './wait-until.js';

/** @import { Run } from '../src/run-record.js' */

const cli = resolve('bin/tds-factory.js');
/**
 * @param {string} cwd
 * @param {string[]} args
 */
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });
/** @param {import('node:child_process').SpawnSyncReturns<string>} result */
const ok = (result) => {
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
/**
 * @param {string} cwd
 * @param {string} id
 * @returns {Run}
 */
const read = (cwd, id) => JSON.parse(readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8'));
/** @param {unknown} value */
const data = (value) => JSON.stringify(value);
const PR = 'https://github.com/o/r/pull/1';

// A Run in Check on top of `origin` (the same repository).
/** @param {string} [existing] @param {string} [title] */
function checked(existing, title = 'Actions') {
  const cwd = existing ?? repo();
  if (!existing) {
    git(cwd, 'config', 'user.name', 't'); // the rebase in sync commits, and CI has no global identity
    git(cwd, 'config', 'user.email', 't@t');
    writeFileSync(join(cwd, '.gitignore'), '.factory/\n');
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-q', '-m', 'ignore');
  }
  const id = ok(run(cwd, 'start', '--data', data({ title, agent: 'claude', commands: 'true', conventions: [] })));
  const wt = read(cwd, id).worktree;
  ok(
    run(cwd, 'update', '--id', id, '--data', data({ spec_link: 'docs/specs/x.md', tickets: ['1'], tickets_total: 1 })),
  );
  ok(run(cwd, 'transition', '--id', id, '--to', 'build'));
  writeFileSync(join(wt, 'mine.txt'), 'mine\n');
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 'mine');
  ok(run(cwd, 'update', '--id', id, '--data', data({ tickets_done: 1 })));
  ok(run(cwd, 'transition', '--id', id, '--to', 'check'));
  return { cwd, id, wt };
}
/**
 * @param {string} cwd
 * @param {string} id
 * @param {string} [security]
 */
const review = (cwd, id, security = 'pass') => {
  ok(run(cwd, 'verify', '--id', id));
  for (const [axis, value] of [
    ['standards', 'pass'],
    ['spec', 'pass'],
    ['security', security],
    ['infrastructure', 'skipped'],
  ])
    ok(run(cwd, 'verdict', '--id', id, '--axis', axis, '--value', value));
};
/**
 * @param {string} cwd
 * @param {string} id
 */
const waiting = (cwd, id) =>
  ok(run(cwd, 'update', '--id', id, '--data', data({ status: 'waiting', waiting_reason: 'accept the Check' })));
/**
 * @param {{ url: string, projectId: string }} dash
 * @param {string} id
 * @param {string} action
 * @param {string} [updated]
 */
async function post(dash, id, action, updated) {
  let stamp = updated ?? '';
  if (action === 'accept' && updated === undefined)
    stamp = (await viewsOf(dash)).find((r) => r.id === id)?.updated ?? '';
  const query = action === 'accept' ? `?updated=${encodeURIComponent(stamp)}` : '';
  const response = await fetch(`${dash.url}/api/projects/${dash.projectId}/runs/${id}/${action}${query}`, {
    method: 'POST',
    headers: await writeHeaders(dash),
  });
  return { status: response.status, text: await response.text() };
}

test('accepting a not-clean Check records the decision for the current head', async () => {
  const { cwd, id, wt } = checked();
  review(cwd, id, 'fail');
  waiting(cwd, id);
  const dash = await startDashboard({ projectDir: cwd, port: 0 });
  try {
    const result = await post(dash, id, 'accept');
    assert.deepEqual(result, { status: 200, text: 'accepted' });
    const accepted = read(cwd, id).accepted;
    assert.ok(accepted, 'the Run records the acceptance');
    assert.equal(accepted.head, git(wt, 'rev-parse', 'HEAD'));
    assert.match(accepted.findings ?? '', /security failed/);
    assert.match(accepted.decision ?? '', /Dashboard/);
    assert.equal(read(cwd, id).status, 'running');
    assert.equal((await post(dash, id, 'accept')).status, 409);
    waiting(cwd, id);
    const again = await post(dash, id, 'accept');
    assert.equal(again.status, 409);
    assert.match(again.text, /already clean or accepted/);
  } finally {
    await dash.close();
  }
});

test('accepting is refused for a clean Check, a Run that is not waiting and an unknown Run', async () => {
  const { cwd, id } = checked();
  review(cwd, id);
  const dash = await startDashboard({ projectDir: cwd, port: 0 });
  try {
    assert.match((await post(dash, id, 'accept')).text, /waits on you/);
    waiting(cwd, id);
    const clean = await post(dash, id, 'accept');
    assert.equal(clean.status, 409);
    assert.match(clean.text, /already clean/);
    assert.equal(read(cwd, id).accepted, undefined);
    assert.equal((await post(dash, 'nope', 'accept')).status, 404);
  } finally {
    await dash.close();
  }
});

test('sync rebases the Run onto the moved origin and clears the Evidence', async () => {
  const { cwd, id, wt } = checked();
  review(cwd, id);
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

test('sync reports a refusal and leaves the Run alone', async () => {
  const { cwd, id, wt } = checked();
  writeFileSync(join(wt, 'dirty.txt'), 'x\n');
  const dash = await startDashboard({ projectDir: cwd, port: 0 });
  try {
    const result = await post(dash, id, 'sync');
    assert.equal(result.status, 409);
    assert.match(result.text, /uncommitted/);
  } finally {
    await dash.close();
  }
});

test('clean-up keeps a Run whose PR is not merged and removes one whose PR is merged', async () => {
  const { cwd, id, wt } = checked();
  review(cwd, id);
  ok(run(cwd, 'transition', '--id', id, '--to', 'finish'));
  ok(run(cwd, 'update', '--id', id, '--data', data({ pr: PR })));
  ok(run(cwd, 'complete', '--id', id));
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

test('accepting is refused when the Run changed since the page showed it', async () => {
  const { cwd, id } = checked();
  review(cwd, id, 'fail');
  waiting(cwd, id);
  const dash = await startDashboard({ projectDir: cwd, port: 0 });
  try {
    const stale = await post(dash, id, 'accept', '2000-01-01T00:00:00.000Z');
    assert.equal(stale.status, 409);
    assert.match(stale.text, /changed since/);
    assert.equal(read(cwd, id).accepted, undefined);
    assert.equal(read(cwd, id).status, 'waiting');
  } finally {
    await dash.close();
  }
});

test('a failed accept puts the Run back to waiting with its reason', async () => {
  const { cwd, id, wt } = checked();
  review(cwd, id, 'fail');
  waiting(cwd, id);
  writeFileSync(join(wt, 'dirty.txt'), 'x\n');
  const dash = await startDashboard({ projectDir: cwd, port: 0 });
  try {
    const result = await post(dash, id, 'accept');
    assert.equal(result.status, 409);
    const record = read(cwd, id);
    assert.equal(record.status, 'waiting');
    assert.equal(record.waiting_reason, 'accept the Check');
    assert.equal(record.accepted, undefined);
  } finally {
    await dash.close();
  }
});

test('clean-up works when the Dashboard was started inside a Run worktree', async () => {
  const { cwd, id, wt } = checked();
  review(cwd, id);
  ok(run(cwd, 'transition', '--id', id, '--to', 'finish'));
  ok(run(cwd, 'update', '--id', id, '--data', data({ pr: PR })));
  ok(run(cwd, 'complete', '--id', id));
  const tip = git(wt, 'rev-parse', 'HEAD');
  const dash = await startDashboard({ projectDir: wt, port: 0, prInfo: () => ({ state: 'MERGED', head: tip }) });
  try {
    assert.deepEqual(await post(dash, id, 'clean'), { status: 200, text: 'cleaned' });
    assert.equal(existsSync(wt), false);
  } finally {
    await dash.close();
  }
});

// ADR 0024: the extra loop. A Run in Check that waits on the user at its loop limit.
function atLimit() {
  const { cwd, id, wt } = checked();
  const file = join(cwd, '.factory', 'runs', id, 'run.json');
  writeFileSync(
    file,
    JSON.stringify({
      ...read(cwd, id),
      check_loops: 4,
      status: 'waiting',
      waiting_on_human: true,
      waiting_reason: 'Blocking findings remain',
    }),
  );
  return { cwd, id, wt };
}
/**
 * @param {{ url: string }} dash
 * @param {string} id
 */
const updatedOf = async (dash, id) => (await viewsOf(dash)).find((r) => r.id === id)?.updated ?? '';
/**
 * @param {{ url: string, projectId: string }} dash
 * @param {string} id
 * @param {string} [query]
 * @param {Record<string, string>} [headers]
 */
const grant = async (dash, id, query, headers) => {
  const response = await fetch(
    `${dash.url}/api/projects/${dash.projectId}/runs/${id}/extra-loop${query ?? `?updated=${encodeURIComponent(await updatedOf(dash, id))}`}`,
    { method: 'POST', headers: headers ?? (await writeHeaders(dash)) },
  );
  return { status: response.status, text: await response.text() };
};

test('the Dashboard grants an extra loop to a Run in Check that waits at its limit', async () => {
  const { cwd, id } = atLimit();
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

test('the extra loop is refused for every Run that is not at its limit in Check and waiting', async () => {
  /** @param {string} cwd */
  const dash = async (cwd) => startDashboard({ projectDir: cwd, port: 0 });
  const below = checked();
  waiting(below.cwd, below.id);
  let d = await dash(below.cwd);
  try {
    const r = await grant(d, below.id);
    assert.equal(r.status, 409);
    assert.match(r.text, /not reached/);
  } finally {
    await d.close();
  }
  const running = checked();
  d = await dash(running.cwd);
  try {
    const r = await grant(d, running.id);
    assert.equal(r.status, 409);
    assert.match(r.text, /waits on you/);
    assert.equal((await grant(d, 'nope')).status, 404);
  } finally {
    await d.close();
  }
  const stale = atLimit();
  d = await dash(stale.cwd);
  try {
    const old = await grant(d, stale.id, '?updated=2000-01-01T00%3A00%3A00.000Z');
    assert.equal(old.status, 409);
    assert.match(old.text, /changed since/);
    assert.equal((await grant(d, stale.id, '')).status, 409);
    assert.equal(read(stale.cwd, stale.id).extra_loops, undefined);
  } finally {
    await d.close();
  }
});

test('the extra loop route refuses a request without the session token, with a wrong one or from another Origin', async () => {
  const { cwd, id } = atLimit();
  const dash = await startDashboard({ projectDir: cwd, port: 0 });
  try {
    const query = `?updated=${encodeURIComponent(await updatedOf(dash, id))}`;
    const good = await writeHeaders(dash);
    /** @type {Record<string, string>[]} */
    const refused = [
      {},
      { Origin: good.Origin },
      { ...good, 'X-Factory-Token': 'wrong' },
      { ...good, Origin: 'https://evil.example' },
      { 'X-Factory-Token': good['X-Factory-Token'] },
    ];
    for (const headers of refused) {
      assert.equal((await grant(dash, id, query, headers)).status, 403, JSON.stringify(Object.keys(headers)));
    }
    assert.equal(read(cwd, id).extra_loops, undefined);
    assert.equal((await grant(dash, id, query)).status, 200);
  } finally {
    await dash.close();
  }
});

test('the Dashboard answers another request while a git call of an action is still running', async () => {
  const { cwd, id } = checked();
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

// A finished Run with a PR, so that clean asks the PR lookup.
/** @param {string} [cwd] @param {string} [title] */
function finished(cwd, title) {
  const made = checked(cwd, title);
  review(made.cwd, made.id);
  ok(run(made.cwd, 'transition', '--id', made.id, '--to', 'finish'));
  ok(run(made.cwd, 'update', '--id', made.id, '--data', data({ pr: PR })));
  ok(run(made.cwd, 'complete', '--id', made.id));
  return { ...made, tip: git(made.wt, 'rev-parse', 'HEAD') };
}
// A promise that is settled from outside, and a way to wait until `count` calls have started.
function gate() {
  /** @type {() => void} */
  let open = () => {};
  const opened = new Promise((done) => (open = () => done(undefined)));
  let entered = 0;
  return {
    opened,
    open,
    enter: () => entered++,
    /** @param {number} count */
    async reached(count) {
      await waitUntil(() => entered >= count, { message: 'the held calls started' });
    },
  };
}

test('a second action on a busy Run is answered 409 and the Run is released afterwards', async () => {
  const { cwd, id, tip } = finished();
  const held = gate();
  const dash = await startDashboard({
    projectDir: cwd,
    port: 0,
    prInfo: async () => {
      held.enter();
      await held.opened;
      return { state: 'OPEN', head: tip };
    },
  });
  try {
    const cleaning = post(dash, id, 'clean');
    await held.reached(1);
    for (const action of ['sync', 'accept', 'extra-loop']) {
      const busy = await post(dash, id, action, 'x');
      assert.deepEqual(busy, { status: 409, text: 'another action on this Run is already running' }, action);
    }
    const merge = await fetch(`${dash.url}/api/projects/${dash.projectId}/runs/${id}/merge`, {
      method: 'POST',
      headers: await writeHeaders(dash),
    });
    assert.equal(merge.status, 409);
    assert.equal(await merge.text(), 'another action on this Run is already running');
    const del = await fetch(`${dash.url}/api/projects/${dash.projectId}/runs/${id}`, {
      method: 'DELETE',
      headers: await writeHeaders(dash),
    });
    assert.equal(del.status, 409);
    assert.equal(await del.text(), 'another action on this Run is already running');
    held.open();
    assert.equal((await cleaning).status, 409);
    assert.notEqual(read(cwd, id).status, 'running');
    const again = await post(dash, id, 'sync');
    assert.doesNotMatch(again.text, /already running/);
  } finally {
    held.open();
    await dash.close();
  }
});

test('the same action on two Runs runs at the same time, and two Dashboards do not block each other', async () => {
  const first = finished(undefined, 'One');
  const second = finished(first.cwd, 'Two');
  const held = gate();
  const prInfo = async () => {
    held.enter();
    await held.opened;
    return { state: 'OPEN', head: first.tip };
  };
  const dash = await startDashboard({ projectDir: first.cwd, port: 0, prInfo });
  const other = await startDashboard({ projectDir: first.cwd, port: 0 });
  try {
    const one = post(dash, first.id, 'clean');
    const two = post(dash, second.id, 'clean');
    await held.reached(2);
    const elsewhere = await post(other, first.id, 'sync');
    assert.doesNotMatch(elsewhere.text, /already running/);
    held.open();
    assert.deepEqual([(await one).status, (await two).status], [409, 409]);
    assert.doesNotMatch((await one).text, /already running/);
  } finally {
    held.open();
    await other.close();
    await dash.close();
  }
});

test(
  'a failing rollback after a failed accept goes to stderr and the answer keeps the accept error',
  { skip: process.platform === 'win32' || process.getuid?.() === 0 },
  async () => {
    const { cwd, id, wt } = checked();
    review(cwd, id, 'fail');
    waiting(cwd, id);
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

test('the Dashboard answers another request while the PR lookup of a clean-up is pending', async () => {
  const { cwd, id, tip } = finished();
  const held = gate();
  const dash = await startDashboard({
    projectDir: cwd,
    port: 0,
    prInfo: async () => {
      held.enter();
      await held.opened;
      return { state: 'MERGED', head: tip };
    },
  });
  try {
    let settled = false;
    const cleaning = post(dash, id, 'clean').finally(() => (settled = true));
    await held.reached(1);
    assert.equal((await fetch(`${dash.url}/api/info`)).status, 200);
    assert.equal(settled, false, 'the clean-up still waits for its lookup');
    held.open();
    assert.deepEqual(await cleaning, { status: 200, text: 'cleaned' });
  } finally {
    held.open();
    await dash.close();
  }
});

test('the default async lookup keeps the Run when no provider handles the link', async () => {
  assert.equal(await ghPrInfoAsync('https://example.com/pr/1'), undefined);
});
