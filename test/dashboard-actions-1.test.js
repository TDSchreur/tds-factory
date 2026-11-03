import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { git } from './git-repo.js';
import { writeHeaders } from './dashboard-token.js';
import { startDashboard } from '../src/dashboard.js';
import { ghPrInfoAsync } from '../src/run-clean.js';
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
  updatedOf,
  grant,
  finished,
  gate,
} from './dashboard-actions-helpers.js';

/** @import { Run } from '../src/run-record.js' */

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

test('the default async lookup keeps the Run when no provider handles the link', async () => {
  assert.equal(await ghPrInfoAsync('https://example.com/pr/1'), undefined);
});
