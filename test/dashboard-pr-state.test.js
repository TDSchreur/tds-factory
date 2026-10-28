import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboard } from '../src/dashboard.js';

const GH = 'https://github.com/o/r/pull/1';

async function views(prs, prState) {
  const project = mkdtempSync(join(tmpdir(), 'dash-pr-'));
  prs.forEach((pr, i) => {
    const dir = join(project, '.factory', 'runs', `2026-01-0${i + 1}-r`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ title: `r${i}`, status: 'done', pr }));
  });
  const dash = await startDashboard({ projectDir: project, port: 0, prState });
  try {
    const get = async () => (await fetch(`${dash.url}/api/views`)).json();
    return { first: await get(), second: await get() };
  } finally { await dash.close(); }
}

test('Done runs with a GitHub PR link get the PR state, cached between polls', async () => {
  const calls = [];
  const { first, second } = await views([GH], async (url) => { calls.push(url); return 'merged'; });
  assert.equal(first[0].prState, 'merged');
  assert.equal(second[0].prState, 'merged');
  assert.deepEqual(calls, [GH]);
});

test('a PR link that is not a GitHub pull request URL is never looked up', async () => {
  const calls = [];
  const { first } = await views(['--web', 'https://example.com/pr/1'], async (url) => { calls.push(url); return 'open'; });
  assert.deepEqual(first.map((r) => r.prState), ['', '']);
  assert.deepEqual(calls, []);
});

test('a failed lookup leaves the state empty', async () => {
  const { first } = await views([GH], async () => { throw new Error('no gh'); });
  assert.equal(first[0].prState, '');
});

async function mergeSetup(state, prMerge, pr = GH, status = 'done') {
  const project = mkdtempSync(join(tmpdir(), 'dash-merge-'));
  const dir = join(project, '.factory', 'runs', '2026-01-01-r');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ title: 'r', status, pr }));
  const dash = await startDashboard({ projectDir: project, port: 0, prState: async () => (typeof state === 'function' ? state() : state), prMerge });
  const post = (id = '2026-01-01-r', origin = dash.url) => fetch(`${dash.url}/api/runs/${id}/merge`, { method: 'POST', headers: { origin } });
  return { dash, post };
}

test('Merge squash-merges an open PR of a Done run', async () => {
  const merged = [];
  const { dash, post } = await mergeSetup('open', async (url) => { merged.push(url); });
  try {
    assert.equal((await post()).status, 200);
    assert.deepEqual(merged, [GH]);
  } finally { await dash.close(); }
});

test('Merge refuses other origins, unknown runs, non-open PRs, active runs and non-GitHub links', async () => {
  for (const [state, pr, status, id, origin, want] of [
    ['open', GH, 'done', undefined, 'http://evil.example', 403],
    ['open', GH, 'done', 'nope', undefined, 404],
    ['merged', GH, 'done', undefined, undefined, 409],
    ['open', GH, 'running', undefined, undefined, 409],
    ['open', GH, 'abandoned', undefined, undefined, 409],
    ['open', 'https://example.com/pr/1', 'done', undefined, undefined, 409],
  ]) {
    const merged = [];
    const { dash, post } = await mergeSetup(state, async (url) => { merged.push(url); }, pr, status);
    try {
      assert.equal((await post(id, origin)).status, want, `${state} ${pr} ${status} ${id}`);
      assert.deepEqual(merged, []);
    } finally { await dash.close(); }
  }
});

test('Merge reports 502 when gh fails', async () => {
  const { dash, post } = await mergeSetup('open', async () => { throw new Error('conflict'); });
  try { assert.equal((await post()).status, 502); } finally { await dash.close(); }
});

test('a merge attempt drops the cached state, so the next poll asks again', async () => {
  let current = 'open';
  const { dash, post } = await mergeSetup(() => current, async () => { current = 'merged'; });
  const states = async () => (await (await fetch(`${dash.url}/api/views`)).json())[0].prState;
  try {
    assert.equal(await states(), 'open');
    assert.equal((await post()).status, 200);
    assert.equal(await states(), 'merged');
  } finally { await dash.close(); }
});
