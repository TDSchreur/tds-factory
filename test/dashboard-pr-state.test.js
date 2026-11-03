import { writeHeaders } from './dashboard-token.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { repo } from './git-repo.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboard } from '../src/dashboard.js';
import { viewsOf } from './run-view.js';

const GH = 'https://github.com/o/r/pull/1';

/**
 * @param {string[]} prs
 * @param {(url: string) => Promise<string>} prState
 */
async function views(prs, prState) {
  const project = mkdtempSync(join(tmpdir(), 'dash-pr-'));
  prs.forEach((pr, i) => {
    const dir = join(project, '.factory', 'runs', `2026-01-0${i + 1}-r`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ title: `r${i}`, status: 'done', pr }));
  });
  const dash = await startDashboard({ projectDir: project, port: 0, prState });
  try {
    const get = () => viewsOf(dash);
    return { first: await get(), second: await get() };
  } finally {
    await dash.close();
  }
}

test('Done runs with a GitHub PR link get the PR state, cached between polls', async () => {
  /** @type {string[]} */
  const calls = [];
  const { first, second } = await views([GH], async (url) => {
    calls.push(url);
    return 'merged';
  });
  assert.equal(first[0].prState, 'merged');
  assert.equal(second[0].prState, 'merged');
  assert.deepEqual(calls, [GH]);
});

test('a PR link that is not a GitHub pull request URL is never looked up', async () => {
  /** @type {string[]} */
  const calls = [];
  const { first } = await views(['--web', 'https://example.com/pr/1'], async (url) => {
    calls.push(url);
    return 'open';
  });
  assert.deepEqual(
    first.map((r) => r.prState),
    ['', ''],
  );
  assert.deepEqual(calls, []);
});

test('a failed lookup leaves the state empty', async () => {
  const { first } = await views([GH], async () => {
    throw new Error('no gh');
  });
  assert.equal(first[0].prState, '');
});

test('the Dashboard has no merge routes and its views have no prCanMerge', async () => {
  const project = repo();
  const dir = join(project, '.factory', 'runs', '2026-01-01-r');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ title: 'r', status: 'done', pr: GH }));
  const dash = await startDashboard({ projectDir: project, port: 0, prState: async () => 'open' });
  try {
    const base = `${dash.url}/api/projects/${dash.projectId}/runs/2026-01-01-r`;
    const merge = await fetch(`${base}/merge`, { method: 'POST', headers: await writeHeaders(dash) });
    assert.equal(merge.status, 405, 'a POST to a path without a route is a method that is not allowed');
    assert.equal((await fetch(`${base}/merge-checks`)).status, 404);
    const [view] = await viewsOf(dash);
    assert.equal(view.prHost, 'github');
    assert.equal('prCanMerge' in view, false);
  } finally {
    await dash.close();
  }
});
