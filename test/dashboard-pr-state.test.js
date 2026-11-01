import { writeHeaders } from './dashboard-token.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { repo, linked, git } from './git-repo.js';
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
  } finally {
    await dash.close();
  }
}

test('Done runs with a GitHub PR link get the PR state, cached between polls', async () => {
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

async function mergeSetup(options = {}) {
  const project = repo();
  const worktree = linked(project);
  git(worktree, 'remote', 'set-url', 'origin', options.originUrl ?? 'https://github.com/o/r.git');
  const head = git(worktree, 'rev-parse', 'HEAD');
  const dir = join(project, '.factory', 'runs', '2026-01-01-r');
  mkdirSync(dir, { recursive: true });
  const reviewed = Object.fromEntries(
    ['standards', 'spec', 'security', 'infrastructure'].map((axis) => [axis, { head, attempt: 1 }]),
  );
  const record = {
    title: 'r',
    status: 'done',
    pr: GH,
    worktree,
    commands: 'npm test',
    check_loops: 0,
    standards: 'pass',
    spec: 'pass',
    security: 'pass',
    infrastructure: 'skipped',
    reviewed,
    verify: { head, dirty: false, command: 'npm test', exit_code: 0 },
    ...options.record,
  };
  const recordFile = join(dir, 'run.json');
  writeFileSync(recordFile, JSON.stringify(record));
  const bin = mkdtempSync(join(tmpdir(), 'fake-gh-'));
  const config = join(bin, 'config.json'),
    calls = join(bin, 'calls.json');
  writeFileSync(calls, '[]');
  const configure = (data) => writeFileSync(config, JSON.stringify({ head, state: 'OPEN', checks: [], ...data }));
  configure(options.gh);
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync(${JSON.stringify(config)}));
const args = process.argv.slice(2);
const calls = JSON.parse(fs.readFileSync(${JSON.stringify(calls)}));
calls.push(args); fs.writeFileSync(${JSON.stringify(calls)}, JSON.stringify(calls));
if (args[1] === 'view') {
  if (config.viewError) process.exit(1);
  console.log(JSON.stringify({ state: config.state, headRefOid: config.head }));
} else if (args[1] === 'checks') {
  if (config.checksError) process.exit(1);
  console.log(JSON.stringify(config.checks));
  if (config.checks.some(c => c.bucket === 'fail')) process.exit(1);
} else if (args[1] === 'merge') {
  if (config.mergeError || (config.mergeHead && args[args.indexOf('--match-head-commit') + 1] !== config.mergeHead)) process.exit(1);
} else process.exit(1);
`,
    { mode: 0o755 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = bin + ':' + previousPath;
  const dash = await startDashboard({ projectDir: project, port: 0 });
  const post = async (id = '2026-01-01-r', origin = dash.url) =>
    fetch(`${dash.url}/api/runs/${id}/merge`, { method: 'POST', headers: await writeHeaders(dash, origin) });
  const checks = () => fetch(`${dash.url}/api/runs/2026-01-01-r/merge-checks`);
  const readCalls = () => JSON.parse(readFileSync(calls, 'utf8'));
  const close = async () => {
    await dash.close();
    process.env.PATH = previousPath;
  };
  return { dash, post, checks, readCalls, configure, close, record, recordFile, worktree, head };
}

const merges = (setup) => setup.readCalls().filter((args) => args[1] === 'merge');

test('Merge uses the clean Check head to protect the squash merge', async () => {
  const setup = await mergeSetup();
  try {
    assert.equal((await setup.post()).status, 200);
    assert.deepEqual(merges(setup), [['pr', 'merge', GH, '--squash', '--match-head-commit', setup.head]]);
  } finally {
    await setup.close();
  }
});

test('Merge accepts a current Accepted Check', async () => {
  const setup = await mergeSetup({ record: { security: 'fail' } });
  try {
    setup.record.accepted = { head: setup.head, findings: 'open finding', decision: 'accepted' };
    writeFileSync(setup.recordFile, JSON.stringify(setup.record));
    assert.equal((await setup.post()).status, 200);
    assert.equal(merges(setup).length, 1);
  } finally {
    await setup.close();
  }
});

test('Merge refuses missing, failed and stale Evidence and a dirty or missing worktree', async () => {
  for (const mutate of [
    (s) => {
      delete s.record.verify;
    },
    (s) => {
      s.record.security = 'fail';
    },
    (s) => {
      s.record.reviewed.spec.head = 'a'.repeat(40);
    },
    (s) => {
      s.record.accepted = { head: 'a'.repeat(40) };
      s.record.security = 'fail';
    },
    (s) => {
      s.record.worktree = '/missing/worktree';
    },
    (s) => {
      writeFileSync(join(s.worktree, 'dirty'), 'x');
    },
  ]) {
    const setup = await mergeSetup();
    try {
      mutate(setup);
      writeFileSync(setup.recordFile, JSON.stringify(setup.record));
      assert.equal((await setup.post()).status, 409);
      assert.deepEqual(merges(setup), []);
    } finally {
      await setup.close();
    }
  }
});

test('Merge rejects unrelated repositories, different PR heads and unavailable GitHub details', async () => {
  for (const options of [
    { originUrl: 'https://github.com/other/r.git' },
    { originUrl: '/local/repo' },
    { gh: { head: 'a'.repeat(40) } },
    { gh: { head: null } },
    { gh: { viewError: true } },
    { gh: { state: 'MERGED' } },
  ]) {
    const setup = await mergeSetup(options);
    try {
      assert.ok([409, 502].includes((await setup.post()).status));
      assert.deepEqual(merges(setup), []);
    } finally {
      await setup.close();
    }
  }
});

test('Merge refuses other origins, unknown runs, active runs and non-GitHub links', async () => {
  for (const [options, id, origin, want] of [
    [{}, undefined, 'http://evil.example', 403],
    [{}, 'nope', undefined, 404],
    [{ record: { status: 'running' } }, undefined, undefined, 409],
    [{ record: { status: 'abandoned' } }, undefined, undefined, 409],
    [{ record: { pr: 'https://example.com/pr/1' } }, undefined, undefined, 409],
    [{ record: { pr: 'https://dev.azure.com/o/p/_git/r/pullrequest/1' } }, undefined, undefined, 409],
  ]) {
    const setup = await mergeSetup(options);
    try {
      assert.equal((await setup.post(id, origin)).status, want);
      assert.deepEqual(merges(setup), []);
    } finally {
      await setup.close();
    }
  }
});

test('Merge reports a failed head-protected merge and drops the cached PR state', async () => {
  const setup = await mergeSetup({ gh: { mergeHead: 'b'.repeat(40) } });
  try {
    const states = async () => (await (await fetch(`${setup.dash.url}/api/views`)).json())[0].prState;
    assert.equal(await states(), 'open');
    assert.equal((await setup.post()).status, 502);
    setup.configure({ state: 'MERGED' });
    assert.equal(await states(), 'merged');
    assert.deepEqual(merges(setup)[0].slice(-2), ['--match-head-commit', setup.head]);
  } finally {
    await setup.close();
  }
});

test('confirmation data names failing, pending and unavailable GitHub checks', async () => {
  const setup = await mergeSetup({
    gh: {
      checks: [
        { name: 'CI', bucket: 'fail', state: 'FAILURE' },
        { name: 'Lint', bucket: 'pending', state: 'PENDING' },
      ],
    },
  });
  try {
    const warning = await (await setup.checks()).text();
    assert.match(warning, /CI: failing/);
    assert.match(warning, /Lint: pending/);
    setup.configure({ checksError: true });
    assert.match(await (await setup.checks()).text(), /checks: unavailable/i);
    setup.configure({ checks: [{ name: 'CI', bucket: 'pass', state: 'SUCCESS' }] });
    assert.match(await (await setup.checks()).text(), /checks: passing/i);
    assert.deepEqual(merges(setup), []);
  } finally {
    await setup.close();
  }
});

test('an Azure DevOps PR cannot be merged or checked from the Dashboard, and the view says so', async () => {
  const setup = await mergeSetup({ record: { pr: 'https://dev.azure.com/o/p/_git/r/pullrequest/1' } });
  try {
    const view = (await (await fetch(`${setup.dash.url}/api/views`)).json())[0];
    assert.deepEqual([view.prHost, view.prCanMerge], ['azure-devops', false]);
    const post = await setup.post();
    assert.equal(post.status, 409);
    assert.match(await post.text(), /cannot merge from the Dashboard/);
    assert.equal((await setup.checks()).status, 409);
    assert.deepEqual(setup.readCalls(), [], 'neither gh nor az was called');
  } finally {
    await setup.close();
  }
});

test('a GitHub PR can be merged and the view says so', async () => {
  const setup = await mergeSetup();
  try {
    const view = (await (await fetch(`${setup.dash.url}/api/views`)).json())[0];
    assert.deepEqual([view.prHost, view.prCanMerge], ['github', true]);
  } finally {
    await setup.close();
  }
});
