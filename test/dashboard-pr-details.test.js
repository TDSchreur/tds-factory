import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboard } from '../src/dashboard.js';
import { readFileSync } from 'node:fs';
import { details } from '../src/pr-azure.js';
import './git-repo.js';

/** @import { Run } from '../src/run-record.js' */

const GH = 'https://github.com/o/r/pull/1';
const AZ = 'https://dev.azure.com/o/p/_git/r/pullrequest/1';

/** @param {Partial<Run>[]} records */
function project(records) {
  const dir = mkdtempSync(join(tmpdir(), 'dash-details-'));
  records.forEach((record, i) => {
    const run = join(dir, '.factory', 'runs', `2026-01-0${i + 1}-r`);
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, 'run.json'), JSON.stringify({ title: `r${i}`, ...record }));
  });
  return dir;
}

/**
 * @param {Partial<Run>[]} records
 * @param {(url: string) => Promise<unknown>} prDetails
 * @param {(get: (n: number) => Promise<Response>, calls: { status: number }) => Promise<void>} body
 */
async function withDashboard(records, prDetails, body) {
  const calls = { status: 0 };
  const dash = await startDashboard({
    projectDir: project(records),
    port: 0,
    prDetails,
    prState: async () => 'open',
    prStatus: async () => {
      calls.status++;
      throw new Error('the status cache must not be used');
    },
  });
  try {
    const runs = /** @type {{ id: string }[]} */ (
      await (await fetch(`${dash.url}/api/projects/${dash.projectId}/runs`)).json()
    );
    await body((n) => fetch(`${dash.url}/api/projects/${dash.projectId}/runs/${runs[n].id}/pr-details`), calls);
  } finally {
    await dash.close();
  }
}
/** @type {Partial<Run>} */
const done = { stage: 'finish', status: 'done', pr: GH };

test('pr-details answers a fresh read for a Done Run and a Run in Follow-up, every time', async () => {
  let n = 0;
  await withDashboard(
    [done, { stage: 'follow-up', status: 'running', pr: GH }],
    async () => ({ state: 'open', n: ++n }),
    async (get, calls) => {
      assert.deepEqual(await (await get(0)).json(), { state: 'open', n: 1 });
      assert.deepEqual(await (await get(0)).json(), { state: 'open', n: 2 });
      assert.equal((await get(1)).status, 200);
      assert.equal(calls.status, 0, 'the PR status cache is bypassed');
    },
  );
});

test('pr-details refuses a Run that is not Done or in Follow-up, has no PR or is abandoned', async () => {
  await withDashboard(
    [
      { stage: 'build', status: 'running', pr: GH },
      { stage: 'finish', status: 'done' },
      { stage: 'finish', status: 'abandoned', pr: GH },
      { stage: 'finish', status: 'done', pr: 'https://example.com/pr/1' },
    ],
    async () => ({ state: 'open' }),
    async (get) => {
      for (const i of [0, 1, 2, 3]) assert.equal((await get(i)).status, 409, String(i));
    },
  );
});

test('a failure is an answer with its reason and the setup steps of the host', async () => {
  await withDashboard(
    [done, { ...done, pr: AZ }, { ...done, pr: 'https://github.com/o/r/pull/3' }],
    async (url) => {
      throw Object.assign(new Error('x'), {
        code: url === AZ ? 'az-not-signed-in' : url === GH ? 'gh-missing' : 'error',
      });
    },
    async (get) => {
      const gh = /** @type {any} */ (await (await get(0)).json());
      assert.equal(gh.unavailable, 'gh-missing');
      assert.ok(gh.setup.some((/** @type {string} */ s) => s.includes('gh auth login')));
      const az = /** @type {any} */ (await (await get(1)).json());
      assert.equal(az.unavailable, 'az-not-signed-in');
      assert.ok(az.setup.some((/** @type {string} */ s) => s.includes('az login')));
      assert.deepEqual(await (await get(2)).json(), { unavailable: 'error' });
    },
  );
});

test('hostile text from the host is passed on as plain JSON strings', async () => {
  const hostile = { state: 'open', threads: [{ path: '<b>x</b>', comment: '<script>alert(1)</script>', url: null }] };
  await withDashboard(
    [done],
    async () => hostile,
    async (get) => {
      const res = await get(0);
      assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
      assert.deepEqual(await res.json(), hostile);
    },
  );
});

test('pr-details of an Azure DevOps PR answers failing and pending checks and threads read through the adapter', async () => {
  const dir = new URL('./fixtures/pr-status/azure/', import.meta.url);
  /** @param {string} file */
  const json = (file) => JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
  const link = 'https://dev.azure.com/example-org/Projects/_git/Kahoot/pullrequest/533';
  /** @param {string[]} argv */
  const run = async (argv) => {
    if (argv[2] === 'show') return { stdout: JSON.stringify(json('sandbox.pr.json')) };
    if (argv[2] === 'policy') return { stdout: '[]' };
    const resource = argv[argv.indexOf('--resource') + 1];
    return {
      stdout: JSON.stringify(
        json(resource === 'pullRequestThreads' ? 'sandbox.threads.json' : 'sandbox.statuses.json'),
      ),
    };
  };
  await withDashboard(
    [{ ...done, pr: link }],
    (url) => details(url, { run }),
    async (get) => {
      const body = /** @type {any} */ (await (await get(0)).json());
      assert.equal(body.state, 'open');
      assert.deepEqual(
        body.failing.map((/** @type {{ name: string }} */ c) => c.name),
        ['fixture/failed-check', 'fixture/error-check'],
      );
      assert.deepEqual(body.pending, ['fixture/pending-check']);
      assert.equal(body.threadsTotal, 4);
      assert.equal(body.threads[0].url, `${link}?discussionId=1879`);
    },
  );
});
