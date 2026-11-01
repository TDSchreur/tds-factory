import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startDashboard } from '../src/dashboard.js';

const GH = 'https://github.com/o/r/pull/1';
const OPEN = {
  state: 'open',
  draft: false,
  checks: { result: 'passing', failing: [] },
  merge: 'mergeable',
  review: 'approved',
};

function project(records) {
  const dir = mkdtempSync(join(tmpdir(), 'dash-prs-'));
  records.forEach((record, i) => {
    const run = join(dir, '.factory', 'runs', `2026-01-0${i + 1}-r`);
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, 'run.json'), JSON.stringify({ title: `r${i}`, ...record }));
  });
  return dir;
}
const finish = { stage: 'finish', status: 'running', pr: GH };

async function withDashboard(records, prStatus, body, options = {}) {
  const dash = await startDashboard({
    projectDir: project(records),
    port: 0,
    prStatus,
    prState: async () => 'open',
    ...options,
  });
  try {
    await body({
      views: async () => (await fetch(`${dash.url}/api/views`)).json(),
      get: (path) => fetch(`${dash.url}${path}`),
    });
  } finally {
    await dash.close();
  }
}
const settle = () => delay(30);

test('a poll never waits for the provider: checking first, then the cached answer', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  await withDashboard(
    [finish],
    async (url) => {
      calls.push(url);
      await gate;
      return OPEN;
    },
    async ({ views }) => {
      assert.deepEqual((await views())[0].prStatus, { checking: true });
      assert.deepEqual((await views())[0].prStatus, { checking: true });
      release();
      await settle();
      assert.deepEqual((await views())[0].prStatus, OPEN);
      assert.deepEqual((await views())[0].prStatus, OPEN);
      assert.deepEqual(calls, [GH]);
    },
  );
});

test('Finish, Follow-up and Done Runs get a status; other Runs and links get none', async () => {
  const calls = [];
  const records = [
    finish,
    { stage: 'follow-up', status: 'running', pr: 'https://github.com/o/r/pull/2' },
    { stage: 'finish', status: 'done', pr: 'https://github.com/o/r/pull/3' },
    { stage: 'build', status: 'running', pr: 'https://github.com/o/r/pull/4' },
    { stage: 'finish', status: 'abandoned', pr: 'https://github.com/o/r/pull/5' },
    { stage: 'finish', status: 'running', pr: 'https://example.com/pr/6' },
    { stage: 'finish', status: 'running' },
  ];
  await withDashboard(
    records,
    async (url) => {
      calls.push(url);
      return OPEN;
    },
    async ({ views }) => {
      const first = await views();
      assert.deepEqual(
        first.map((r) => r.prStatus === null),
        [false, false, false, true, true, true, true],
      );
      await settle();
      assert.deepEqual(calls.sort(), [
        'https://github.com/o/r/pull/1',
        'https://github.com/o/r/pull/2',
        'https://github.com/o/r/pull/3',
      ]);
    },
  );
});

test('a provider failure becomes an unavailable status with its reason, never an error, and is tried again later', async () => {
  let mode = 'rate-limited';
  await withDashboard(
    [finish],
    async () => {
      if (mode) throw Object.assign(new Error('x'), { reason: mode });
      return OPEN;
    },
    async ({ views, get }) => {
      await views();
      await settle();
      assert.deepEqual((await views())[0].prStatus, { unavailable: 'rate-limited' });
      mode = '';
      // A plain poll keeps the cached failure; the user's refresh asks again.
      const refreshed = await (await get(`/api/runs/2026-01-01-r/pr-status?refresh=1`)).json();
      assert.deepEqual(refreshed, OPEN);
      assert.deepEqual((await views())[0].prStatus, OPEN);
    },
    { statusRefreshMs: 0 },
  );
});

test('an unknown failure reason is reported as error, and a throwing provider does not break the board', async () => {
  await withDashboard(
    [finish, { stage: 'define', status: 'running', title: 'other' }],
    async () => {
      throw new Error('boom');
    },
    async ({ views }) => {
      await views();
      await settle();
      const list = await views();
      assert.deepEqual(list[0].prStatus, { unavailable: 'error' });
      assert.equal(list.length, 2);
    },
  );
});

test('the pr-status route answers for a Run, refuses others and limits refreshes', async () => {
  const calls = [];
  await withDashboard(
    [finish, { stage: 'build', status: 'running' }],
    async (url) => {
      calls.push(url);
      return OPEN;
    },
    async ({ get }) => {
      assert.equal((await get('/api/runs/nope/pr-status')).status, 404);
      assert.equal((await get('/api/runs/2026-01-02-r/pr-status')).status, 409);
      assert.equal((await get('/api/runs/%E0%A4%A/pr-status')).status, 400);
      const first = await get('/api/runs/2026-01-01-r/pr-status?refresh=1');
      assert.equal(first.status, 200);
      assert.deepEqual(await first.json(), OPEN);
      assert.deepEqual(await (await get('/api/runs/2026-01-01-r/pr-status?refresh=1')).json(), OPEN);
      assert.deepEqual(calls, [GH], 'a second refresh within a few seconds reuses the answer');
      assert.equal((await fetch((await get('/api/runs/2026-01-01-r/pr-status')).url, { method: 'POST' })).status, 403);
    },
  );
});

test('a merged PR is not looked up again within ten minutes', async () => {
  const calls = [];
  await withDashboard(
    [{ stage: 'finish', status: 'done', pr: GH }],
    async (url) => {
      calls.push(url);
      return { ...OPEN, state: 'merged' };
    },
    async ({ views }) => {
      await views();
      await settle();
      await views();
      await views();
      assert.equal((await views())[0].prStatus.state, 'merged');
      assert.equal(calls.length, 1);
    },
  );
});

test('an Azure DevOps PR gets a status from the same cache and shows its host and reasons', async () => {
  const AZ = 'https://dev.azure.com/o/p/_git/r/pullrequest/1';
  const calls = [];
  const records = [
    { stage: 'finish', status: 'running', pr: AZ },
    { stage: 'finish', status: 'running', pr: 'https://dev.azure.com/o/p/_git/r/pullrequest/2' },
  ];
  await withDashboard(
    records,
    async (url) => {
      calls.push(url);
      if (url === AZ) return OPEN;
      throw Object.assign(new Error('x'), { reason: 'az-extension-missing' });
    },
    async ({ views }) => {
      await views();
      await settle();
      const list = await views();
      assert.deepEqual(
        list.map((r) => [r.prHost, r.prCanMerge, r.prStatus.unavailable ?? r.prStatus.state]),
        [
          ['azure-devops', false, 'open'],
          ['azure-devops', false, 'az-extension-missing'],
        ],
      );
      assert.deepEqual(
        calls.sort(),
        records.map((r) => r.pr),
      );
    },
  );
});

test('an unknown reason of a provider shows as a plain error', async () => {
  await withDashboard(
    [finish],
    async () => {
      throw Object.assign(new Error('x'), { reason: 'whatever' });
    },
    async ({ views }) => {
      await views();
      await settle();
      assert.deepEqual((await views())[0].prStatus, { unavailable: 'error' });
    },
  );
});
