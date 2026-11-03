import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { details, launch, statusAsync } from '../src/pr-azure.js';

// Recorded output of the sandbox repository Kahoot (see the README of the fixtures folder); the stand-in for `az` never starts a process.
const DIR = new URL('./fixtures/pr-status/azure/', import.meta.url);
/** @param {string} file */
const json = (file) => JSON.parse(readFileSync(new URL(file, DIR), 'utf8'));
const PROJECT = '00000000-0000-4000-8000-000000000001';
const REPO = '00000000-0000-4000-8000-000000000002';
const URL_ = 'https://dev.azure.com/example-org/Projects/_git/Kahoot/pullrequest/533';
const BASE = `https://dev.azure.com/example-org/Projects/_git/Kahoot/pullrequest/533?discussionId=`;

/**
 * @typedef {object} Answers
 * @property {any} [pr]
 * @property {any} [policies]
 * @property {any} [threads]
 * @property {any} [statuses]
 */
/**
 * A stand-in for `az` that records every argument list.
 * @param {Answers} [answers]
 * @returns {{ run: (argv: string[]) => Promise<{ stdout: string }>, calls: string[][] }}
 */
const az = (answers = {}) => {
  const { pr, policies, threads, statuses } = answers;
  /** @type {string[][]} */
  const calls = [];
  return {
    calls,
    run: async (argv) => {
      calls.push(argv);
      if (argv[0] === 'repos' && argv[2] === 'show') return { stdout: JSON.stringify(pr ?? json('sandbox.pr.json')) };
      if (argv[0] === 'repos' && argv[2] === 'policy') return { stdout: JSON.stringify(policies ?? []) };
      const resource = argv[argv.indexOf('--resource') + 1];
      if (resource === 'pullRequestThreads')
        return { stdout: JSON.stringify('threads' in answers ? threads : json('sandbox.threads.json')) };
      if (resource === 'pullRequestStatuses')
        return { stdout: JSON.stringify('statuses' in answers ? statuses : json('sandbox.statuses.json')) };
      throw new Error('unexpected ' + argv.join(' '));
    },
  };
};
/** @param {string} code @param {RegExp} [message] @returns {(err: unknown) => boolean} */
const failsWith = (code, message) => (err) =>
  err instanceof Error && 'code' in err && err.code === code && (message?.test(err.message) ?? true);
/** @param {number} id @param {string} content @param {Record<string, unknown>} [extra] */
const thread = (id, content, extra = {}) => ({
  id,
  status: 'active',
  comments: [{ id: 1, parentCommentId: 0, commentType: 'text', content }],
  threadContext: { filePath: '/a.txt' },
  properties: null,
  ...extra,
});
/** @param {any[]} value */
const threadsOf = (value) => ({ count: value.length, value });

test('the recorded threads list the unresolved person threads only, with path, text and link', async () => {
  const d = await details(URL_, { run: az().run });
  assert.deepEqual(d.threads, [
    { path: '/throwaway-notes.txt', comment: 'Thread with status active', url: `${BASE}1879` },
    { path: '', comment: 'Thread with status pending', url: `${BASE}1880` },
    { path: '', comment: 'Whole-PR thread, active', url: `${BASE}1885` },
    { path: '', comment: 'Thread to be deleted', url: `${BASE}1886` },
  ]);
  assert.equal(d.threadsTotal, 4);
});

test('fixed, closed, by design and will not fix threads are not unresolved', async () => {
  const ids = (await details(URL_, { run: az().run })).threads?.map((t) => t.url?.split('=')[1]);
  for (const id of ['1881', '1882', '1883', '1884']) assert.equal(ids?.includes(id), false, id);
});

test('system threads, deleted comments and deleted threads are left out', async () => {
  const derived = json('sandbox-derived.threads.json');
  const d = await details(URL_, { run: az({ threads: derived }).run });
  // The vote, push and policy update threads are system threads (the policy one is still active); the only-deleted thread has no person comment.
  assert.deepEqual(d.threads, [{ path: '', comment: 'Second comment stays', url: `${BASE}1905` }]);
  assert.equal(d.threadsTotal, 1);
  const gone = await details(URL_, { run: az({ threads: threadsOf([thread(1, 'x', { isDeleted: true })]) }).run });
  assert.deepEqual([gone.threads, gone.threadsTotal], [[], 0]);
});

test('a thread with a CodeReviewThreadType property is a system thread even with a text comment', async () => {
  const marked = thread(7, 'x', {
    properties: { CodeReviewThreadType: { $type: 'System.String', $value: 'VoteUpdate' } },
  });
  const d = await details(URL_, { run: az({ threads: threadsOf([marked, thread(8, 'y')]) }).run });
  assert.deepEqual(
    d.threads?.map((t) => t.comment),
    ['y'],
  );
});

test('statuses: the latest per context wins, failed and error fail, pending pends, the rest are no check', async () => {
  const d = await details(URL_, { run: az().run });
  assert.deepEqual(d.failing, [
    { name: 'fixture/failed-check', url: 'https://ci.example.test/builds/42' },
    { name: 'fixture/error-check', url: null },
  ]);
  assert.deepEqual([d.failingTotal, d.pending, d.pendingTotal], [2, ['fixture/pending-check'], 1]);
  // twice-check was failed first and succeeded second, in either response order.
  const reversed = { ...json('sandbox.statuses.json') };
  reversed.value = [...reversed.value].reverse();
  assert.deepEqual((await details(URL_, { run: az({ statuses: reversed }).run })).failing?.length, 2);
  const failedLast = threadsOf([
    { id: 2, state: 'succeeded', context: { name: 'c', genre: 'g' }, creationDate: '2026-11-03T10:00:00Z' },
    { id: 1, state: 'failed', context: { name: 'c', genre: 'g' }, creationDate: '2026-11-03T11:00:00Z' },
  ]);
  assert.equal((await details(URL_, { run: az({ statuses: failedLast }).run })).failingTotal, 1);
});

test('a status without a genre is named by its name, and a non-https target is no link', async () => {
  const statuses = threadsOf([
    { id: 1, state: 'failed', context: { name: 'plain' }, targetUrl: 'http://ci.example/1' },
    { id: 2, state: 'error', context: { name: 'js', genre: 'g' }, targetUrl: 'javascript:alert(1)' },
  ]);
  const d = await details(URL_, { run: az({ statuses }).run });
  assert.deepEqual(d.failing, [
    { name: 'plain', url: null },
    { name: 'g/js', url: null },
  ]);
});

test('a failing build policy is a failing check linked to its build; a queued one is pending', async () => {
  const policies = json('failing-build.policies.json');
  const d = await details(URL_, { run: az({ policies, statuses: threadsOf([]), threads: threadsOf([]) }).run });
  assert.deepEqual(d.failing, [
    { name: 'Fixture build', url: 'https://dev.azure.com/example-org/Projects/_build/results?buildId=4242' },
  ]);
  const queued = structuredClone(policies);
  queued[0].status = 'queued';
  const q = await details(URL_, { run: az({ policies: queued, statuses: threadsOf([]), threads: threadsOf([]) }).run });
  assert.deepEqual([q.failing, q.pending], [[], ['Fixture build']]);
  const hostile = structuredClone(policies);
  hostile[0].context.buildId = '1/../x';
  const h = await details(URL_, {
    run: az({ policies: hostile, statuses: threadsOf([]), threads: threadsOf([]) }).run,
  });
  assert.equal(h.failing?.[0].url, null);
});

test('the link of a build uses the encoded project of the PR link', async () => {
  const pr = json('sandbox.pr.json');
  pr.repository.project.name = 'My Project';
  const policies = json('failing-build.policies.json');
  const d = await details('https://dev.azure.com/example-org/My%20Project/_git/Kahoot/pullrequest/533', {
    run: az({ pr, policies, statuses: threadsOf([]), threads: threadsOf([]) }).run,
  });
  assert.equal(d.failing?.[0].url, 'https://dev.azure.com/example-org/My%20Project/_build/results?buildId=4242');
});

test('reviewer policies and the merge strategy policy are no checks', async () => {
  const policies = json('merge-strategy.policies.json');
  const d = await details(URL_, { run: az({ policies, statuses: threadsOf([]), threads: threadsOf([]) }).run });
  assert.deepEqual([d.failing, d.pending], [[], []]);
  const review = json('review-required.policies.json');
  const r = await details(URL_, { run: az({ policies: review, statuses: threadsOf([]), threads: threadsOf([]) }).run });
  assert.deepEqual([r.failingTotal, r.pendingTotal], [0, 0]);
});

test('conflicts: true, false and null; draft', async () => {
  /** @param {string} mergeStatus */
  const conflicts = async (mergeStatus) =>
    (await details(URL_, { run: az({ pr: { ...json('sandbox.pr.json'), mergeStatus } }).run })).conflicts;
  assert.deepEqual(
    [await conflicts('conflicts'), await conflicts('succeeded'), await conflicts('queued')],
    [true, false, null],
  );
  const missing = { ...json('sandbox.pr.json') };
  delete missing.mergeStatus;
  assert.equal((await details(URL_, { run: az({ pr: missing }).run })).conflicts, null);
  assert.equal((await details(URL_, { run: az({ pr: json('draft.pr.json') }).run })).draft, true);
});

test('a completed or abandoned PR gives only its state and reads no threads or statuses', async () => {
  for (const [key, state] of [
    ['completed', 'merged'],
    ['abandoned', 'closed'],
  ]) {
    const { run, calls } = az({ pr: json(`${key}.pr.json`) });
    assert.deepEqual(await details(URL_, { run }), { state });
    assert.equal(
      calls.some((c) => c.includes('invoke')),
      false,
    );
  }
});

test('caps and totals: 50 listed, the rest counted, names and comments cut', async () => {
  const many = threadsOf(Array.from({ length: 60 }, (_, i) => thread(i + 1, 'c'.repeat(400))));
  const statuses = threadsOf(
    Array.from({ length: 60 }, (_, i) => ({
      id: i + 1,
      state: i % 2 ? 'failed' : 'pending',
      context: { name: 'n'.repeat(200) + i },
    })),
  );
  const d = await details(URL_, { run: az({ threads: many, statuses }).run });
  assert.deepEqual([d.threads?.length, d.threadsTotal, d.threads?.[0].comment.length], [50, 60, 300]);
  assert.deepEqual([d.failing?.length, d.failingTotal, d.pending?.length, d.pendingTotal], [30, 30, 30, 30]);
  assert.equal(d.failing?.[0].name.length, 120);
});

test('hostile text is plain text: control and bidi characters become spaces, links must be https', async () => {
  const hostile = thread(5, '<img src=x onerror=alert(1)>‮\u0007\u001b[31m evil', {
    threadContext: { filePath: '/a\u0000b<script>.txt' },
  });
  const d = await details(URL_, { run: az({ threads: threadsOf([hostile]) }).run });
  assert.equal(d.threads?.[0].comment, '<img src=x onerror=alert(1)>   [31m evil');
  assert.equal(d.threads?.[0].path, '/a b<script>.txt');
  assert.equal(d.threads?.[0].url, `${BASE}5`);
  const odd = threadsOf([{ ...thread(6, 'x'), id: '6/../x' }, thread(0.5, 'y')]);
  const o = await details(URL_, { run: az({ threads: odd }).run });
  assert.deepEqual(
    o.threads?.map((t) => t.url),
    [null, null],
  );
});

test('the argument lists carry GUIDs, never decoded names, and only GET reads', async () => {
  const pr = json('sandbox.pr.json');
  pr.repository.name = 'My Repo';
  pr.repository.project.name = 'My Project';
  const { run, calls } = az({ pr });
  await details('https://dev.azure.com/example-org/My%20Project/_git/My%20Repo/pullrequest/533', { run });
  const invokes = calls.filter((c) => c[0] === 'devops');
  assert.equal(invokes.length, 2);
  for (const argv of invokes) {
    assert.deepEqual(argv.slice(0, 3), ['devops', 'invoke', '--area']);
    assert.equal(argv[argv.indexOf('--area') + 1], 'git');
    assert.deepEqual(argv.slice(argv.indexOf('--route-parameters') + 1, argv.indexOf('--route-parameters') + 4), [
      `project=${PROJECT}`,
      `repositoryId=${REPO}`,
      'pullRequestId=533',
    ]);
    assert.equal(argv[argv.indexOf('--api-version') + 1], '7.1');
    assert.equal(argv[argv.indexOf('--organization') + 1], 'https://dev.azure.com/example-org');
    assert.ok(argv.includes('--only-show-errors') && argv.includes('--output'));
    assert.equal(argv.includes('--http-method'), false);
    assert.equal(argv.join(' ').includes('My'), false);
  }
  assert.deepEqual(invokes.map((c) => c[c.indexOf('--resource') + 1]).sort(), [
    'pullRequestStatuses',
    'pullRequestThreads',
  ]);
  for (const argv of invokes) assert.doesNotThrow(() => launch(argv, 'win32'));
});

test('a GUID that is not a GUID never reaches az', async () => {
  for (const bad of ['x&whoami', 'My Project', '', 1, undefined]) {
    const pr = json('sandbox.pr.json');
    pr.repository.id = bad;
    const { run, calls } = az({ pr });
    await assert.rejects(details(URL_, { run }), failsWith('error'));
    assert.equal(
      calls.some((c) => c[0] === 'devops'),
      false,
    );
  }
  const pr = json('sandbox.pr.json');
  pr.repository.project.id = 'not-a-guid';
  await assert.rejects(details(URL_, { run: az({ pr }).run }), failsWith('error'));
});

test('a PR that does not belong to the link is refused', async () => {
  const pr = json('sandbox.pr.json');
  pr.repository.name = 'Other';
  await assert.rejects(details(URL_, { run: az({ pr }).run }), failsWith('error', /does not belong/));
});

test('every failure code of the adapter holds for threads and statuses too', async () => {
  const cases = /** @type {[string, any][]} */ ([
    ['az-missing', { code: 'ENOENT' }],
    ['az-extension-missing', { stderr: "'devops' is misspelled or not recognized by the system" }],
    ['az-not-signed-in', { stderr: 'Please run az login' }],
    ['rate-limited', { stderr: 'TF400733: rate limit' }],
    ['error', { stderr: 'boom' }],
  ]);
  for (const resource of ['pullRequestThreads', 'pullRequestStatuses'])
    for (const [code, props] of cases) {
      const base = az().run;
      /** @param {string[]} argv */
      const run = async (argv) => {
        if (argv.includes(resource)) throw Object.assign(new Error('x'), props);
        return base(argv);
      };
      await assert.rejects(details(URL_, { run }), failsWith(code), `${resource} ${code}`);
    }
});

test('an answer that is not the recorded shape is an error', async () => {
  for (const threads of [null, [], {}, { value: 'x' }, { value: [null] }, { value: [{ id: 1 }] }])
    await assert.rejects(details(URL_, { run: az({ threads }).run }), failsWith('error'), JSON.stringify(threads));
  for (const statuses of [null, [], {}, { value: [{ state: 'failed' }] }, { value: [null] }])
    await assert.rejects(details(URL_, { run: az({ statuses }).run }), failsWith('error'), JSON.stringify(statuses));
  const garbage = async (/** @type {string[]} */ argv) =>
    argv.includes('pullRequestThreads') ? { stdout: 'not json' } : az().run(argv);
  await assert.rejects(details(URL_, { run: garbage }), failsWith('error'));
});

test('a response with a continuation token counts for what it returned', async () => {
  const threads = { ...threadsOf([thread(1, 'a')]), continuation_token: 'next' };
  const d = await details(URL_, { run: az({ threads }).run });
  assert.deepEqual([d.threads?.length, d.threadsTotal], [1, 1]);
});

test('the status line counts the PR statuses as checks too, so card and drawer agree', async () => {
  const s = await statusAsync(URL_, { run: az().run });
  assert.deepEqual(s.checks, { result: 'failing', failing: ['fixture/failed-check', 'fixture/error-check'] });
  const pending = threadsOf([{ id: 1, state: 'pending', context: { name: 'p' } }]);
  assert.deepEqual((await statusAsync(URL_, { run: az({ statuses: pending }).run })).checks, {
    result: 'pending',
    failing: [],
  });
  const ok = threadsOf([{ id: 1, state: 'succeeded', context: { name: 'p' } }]);
  assert.deepEqual((await statusAsync(URL_, { run: az({ statuses: ok }).run })).checks, {
    result: 'none',
    failing: [],
  });
});

test('invoke is only ever followed by the two read resources, and no write method is named', () => {
  const source = readFileSync('src/pr-azure.js', 'utf8');
  const resources = [...source.matchAll(/'(pullRequest\w+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(resources)].sort(), ['pullRequestStatuses', 'pullRequestThreads']);
  assert.equal(source.match(/'invoke'/g)?.length, 1);
  assert.doesNotMatch(source, /--http-method|POST|PATCH|PUT|DELETE/);
  for (const file of readdirSync('src')) {
    if (file === 'pr-azure.js') continue;
    assert.doesNotMatch(readFileSync(join('src', file), 'utf8'), /'invoke'/, file);
  }
});

test('launch lets name=value through on Windows and still refuses anything else', () => {
  const argv = [
    'devops',
    'invoke',
    '--route-parameters',
    `project=${PROJECT}`,
    'pullRequestId=533',
    '--api-version',
    '7.1',
  ];
  const [file, args, options] = launch(argv, 'win32');
  assert.equal(file, process.env.ComSpec || 'cmd.exe');
  assert.deepEqual(args, ['/d', '/s', '/c', `az.cmd ${argv.join(' ')}`]);
  assert.equal(options.windowsVerbatimArguments, true);
  for (const arg of ['a=b&whoami', 'a=b c', 'a="b"', 'a=%PATH%', 'a=b^c', 'a=b|c', 'a=b>c', 'a=b;c', 'a=$(x)', 'a=`x`'])
    assert.throws(() => launch(['invoke', arg], 'win32'), /unsafe argument/, arg);
  assert.deepEqual(launch(argv, 'linux')[1], argv);
});
