import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { git, repo } from './git-repo.js';
import { writeHeaders } from './dashboard-token.js';
import { startDashboard } from '../src/dashboard.js';

const cli = resolve('bin/tds-factory.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });
const ok = (result) => { assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const read = (cwd, id) => JSON.parse(readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8'));
const data = (value) => JSON.stringify(value);
const PR = 'https://github.com/o/r/pull/1';

// A Run in Check on top of `origin` (the same repository).
function checked() {
  const cwd = repo();
  writeFileSync(join(cwd, '.gitignore'), '.factory/\n');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'ignore');
  const id = ok(run(cwd, 'start', '--data', data({ title: 'Actions', agent: 'claude', commands: 'true', conventions: [] })));
  const wt = read(cwd, id).worktree;
  ok(run(cwd, 'update', '--id', id, '--data', data({ spec_link: 'docs/specs/x.md', tickets: ['1'], tickets_total: 1 })));
  ok(run(cwd, 'transition', '--id', id, '--to', 'build'));
  writeFileSync(join(wt, 'mine.txt'), 'mine\n');
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 'mine');
  ok(run(cwd, 'update', '--id', id, '--data', data({ tickets_done: 1 })));
  ok(run(cwd, 'transition', '--id', id, '--to', 'check'));
  return { cwd, id, wt };
}
const review = (cwd, id, security = 'pass') => {
  ok(run(cwd, 'verify', '--id', id));
  for (const [axis, value] of [['standards', 'pass'], ['spec', 'pass'], ['security', security], ['infrastructure', 'skipped']]) ok(run(cwd, 'verdict', '--id', id, '--axis', axis, '--value', value));
};
const waiting = (cwd, id) => ok(run(cwd, 'update', '--id', id, '--data', data({ status: 'waiting', waiting_reason: 'accept the Check' })));
async function post(dash, id, action, updated) {
  if (action === 'accept' && updated === undefined) updated = (await (await fetch(`${dash.url}/api/views`)).json()).find((r) => r.id === id)?.updated ?? '';
  const query = action === 'accept' ? `?updated=${encodeURIComponent(updated)}` : '';
  const response = await fetch(`${dash.url}/api/runs/${id}/${action}${query}`, { method: 'POST', headers: await writeHeaders(dash) });
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
    assert.equal(accepted.head, git(wt, 'rev-parse', 'HEAD'));
    assert.match(accepted.findings, /security failed/);
    assert.match(accepted.decision, /Dashboard/);
    assert.equal(read(cwd, id).status, 'running');
    assert.equal((await post(dash, id, 'accept')).status, 409);
    waiting(cwd, id);
    const again = await post(dash, id, 'accept');
    assert.equal(again.status, 409);
    assert.match(again.text, /already clean or accepted/);
  } finally { await dash.close(); }
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
  } finally { await dash.close(); }
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
  } finally { await dash.close(); }
});

test('sync reports a refusal and leaves the Run alone', async () => {
  const { cwd, id, wt } = checked();
  writeFileSync(join(wt, 'dirty.txt'), 'x\n');
  const dash = await startDashboard({ projectDir: cwd, port: 0 });
  try {
    const result = await post(dash, id, 'sync');
    assert.equal(result.status, 409);
    assert.match(result.text, /uncommitted/);
  } finally { await dash.close(); }
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
  } finally { await dash.close(); }
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
  } finally { await dash.close(); }
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
  } finally { await dash.close(); }
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
  } finally { await dash.close(); }
});
