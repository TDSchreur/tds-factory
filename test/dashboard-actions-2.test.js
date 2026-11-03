import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import './git-repo.js'; // isolates the Factory config folder
import { writeHeaders } from './dashboard-token.js';
import { startDashboard } from '../src/dashboard.js';
import { read, checked, review, waiting, post, atLimit, grant, finished, gate } from './dashboard-actions-helpers.js';

/** @import { Run } from '../src/run-record.js' */

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
