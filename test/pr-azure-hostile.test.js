import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { details, observeFlow } from '../src/pr-azure.js';

// Adversarial input for the Azure DevOps parsers: every text and number comes from Azure DevOps and is untrusted.
const DIR = new URL('./fixtures/pr-status/azure/', import.meta.url);
/** @param {string} file */
const json = (file) => JSON.parse(readFileSync(new URL(file, DIR), 'utf8'));
const URL_ = 'https://dev.azure.com/example-org/Projects/_git/Kahoot/pullrequest/533';
const HEAD = 'a'.repeat(40);
const LIMIT_MS = 3000;

/** @param {{ pr?: any, policies?: any, threads?: any, statuses?: any }} answers */
const answerOf = (answers) => (/** @type {string[]} */ argv) => {
  const resource = argv[argv.indexOf('--resource') + 1];
  if (resource === 'pullRequestThreads') return answers.threads ?? { value: [] };
  if (resource === 'pullRequestStatuses') return answers.statuses ?? { value: [] };
  if (argv[0] === 'repos' && argv[2] === 'show')
    return answers.pr ?? { ...json('sandbox.pr.json'), lastMergeSourceCommit: { commitId: HEAD } };
  return answers.policies ?? [];
};
/** @param {Parameters<typeof answerOf>[0]} answers */
const run = (answers) => async (/** @type {string[]} */ argv) => ({ stdout: JSON.stringify(answerOf(answers)(argv)) });
/** @param {number} id @param {unknown} content @param {Record<string, unknown>} [extra] */
const thread = (id, content, extra = {}) => ({
  id,
  status: 'active',
  comments: [{ id: 1, commentType: 'text', content }],
  threadContext: { filePath: '/a.txt' },
  ...extra,
});
/** @param {import('../src/git.js').Flow} flow @param {Parameters<typeof answerOf>[0]} answers */
function drive(flow, answers) {
  const answer = answerOf(answers);
  let next = flow.next();
  while (!next.done) {
    const [file, , args] = /** @type {{ command: [string, string | undefined, string[]] }} */ (
      /** @type {unknown} */ (next.value)
    ).command;
    const argv = file === 'az' ? args : /** @type {string} */ (args.at(-1)).replace(/^az\.cmd /, '').split(' ');
    next = flow.next({ status: 0, stdout: JSON.stringify(answer(argv)), stderr: '' });
  }
  return next.value;
}

test('details: thousands of threads and statuses stay capped and finish in bounded time', async () => {
  const threads = { value: Array.from({ length: 20000 }, (_, i) => thread(i + 1, 'x'.repeat(2000))) };
  const statuses = {
    value: Array.from({ length: 20000 }, (_, i) => ({ id: i + 1, state: 'failed', context: { name: `s${i}` } })),
  };
  const start = Date.now();
  const d = await details(URL_, { run: run({ threads, statuses }) });
  assert.ok(Date.now() - start < LIMIT_MS);
  assert.deepEqual([d.threads?.length, d.threadsTotal, d.failing?.length, d.failingTotal], [50, 20000, 50, 20000]);
});

test('details: a megabyte of text, bidi and zero-width characters is cut and neutralised', async () => {
  const text = '\u202e\u200b\u2066' + 'é'.repeat(1_000_000);
  const d = await details(URL_, {
    run: run({
      threads: { value: [thread(1, text, { threadContext: { filePath: text } })] },
      statuses: { value: [{ id: 1, state: 'failed', context: { name: text } }] },
    }),
  });
  assert.equal(d.threads?.[0].comment.length, 300);
  assert.equal(d.threads?.[0].path.length, 300);
  assert.equal(d.failing?.[0].name.length, 120);
  assert.ok(!/[\u202e\u200b\u2066]/.test(JSON.stringify(d.threads) + JSON.stringify(d.failing)));
});

test('details: only a short https target is a link; javascript, http, data, spaces and huge links are not', async () => {
  const targets = [
    'javascript:alert(1)',
    'http://dev.azure.com/x',
    'data:text/html,<script>1</script>',
    'https://x.test/a b',
    'https://x.test/\u0000',
    'https://x.test/' + 'a'.repeat(600),
    42,
    null,
  ];
  const statuses = {
    value: targets.map((targetUrl, i) => ({ id: i + 1, state: 'failed', context: { name: `s${i}` }, targetUrl })),
  };
  const d = await details(URL_, { run: run({ statuses }) });
  assert.deepEqual(
    d.failing?.map((c) => c.url),
    targets.map(() => null),
  );
});

test('details: a build id that is not a positive safe integer gives no link, never text in a link', async () => {
  for (const buildId of ['12', '12; calc', 1.5, -1, 0, 1e20, null, {}, [1]]) {
    const policies = json('failing-build.policies.json');
    policies[0].context.buildId = buildId;
    const d = await details(URL_, { run: run({ policies }) });
    assert.deepEqual(
      d.failing?.map((c) => c.url),
      [null],
      String(buildId),
    );
  }
});

test('details: thread ids that are not positive safe integers give no link', async () => {
  const ids = ['7', '1/../x', 1.5, -2, 0, 2 ** 60, null, {}];
  const threads = { value: ids.map((id) => ({ ...thread(1, 'c'), id })) };
  const d = await details(URL_, { run: run({ threads }) });
  assert.deepEqual(
    d.threads?.map((t) => t.url),
    ids.map(() => null),
  );
});

test('details: malformed shapes are errors, never an empty list that looks clean', async () => {
  const bad = [
    { value: [{ id: 1, status: 'active', comments: 'x' }] },
    { value: [{ id: 1, status: 'active', comments: null }] },
    { value: 5 },
    { value: { length: 3 } },
    'text',
    7,
  ];
  for (const threads of bad)
    await assert.rejects(details(URL_, { run: run({ threads }) }), /Azure DevOps/, JSON.stringify(threads));
  for (const statuses of [{ value: [{ id: 'x', state: 'failed', context: { name: 'n' } }] }, { value: [[]] }])
    await assert.rejects(details(URL_, { run: run({ statuses }) }), /Azure DevOps/, JSON.stringify(statuses));
});

test('observeFlow: thousands of threads finish in bounded time and keep every finding', () => {
  const threads = { value: Array.from({ length: 5000 }, (_, i) => thread(i + 1, 'c')) };
  const start = Date.now();
  const value = drive(observeFlow(URL_, HEAD), { threads });
  assert.ok(Date.now() - start < LIMIT_MS);
  assert.equal(value.threads.length, 5000);
});

test('observeFlow: non-integer thread ids and non-string comments are refused, not recorded', () => {
  for (const id of ['7', 1.5, -1, null])
    assert.throws(
      () => drive(observeFlow(URL_, HEAD), { threads: { value: [thread(1, 'c', { id })] } }),
      /incomplete/,
      String(id),
    );
  for (const content of [null, 5, {}, ['a']])
    assert.throws(
      () => drive(observeFlow(URL_, HEAD), { threads: { value: [thread(1, content)] } }),
      /incomplete/,
      JSON.stringify(content),
    );
});

test('observeFlow: a hostile status link is dropped and a hostile name stays data', () => {
  const statuses = {
    value: [
      { id: 1, state: 'failed', context: { name: '\u202e<b>x' }, targetUrl: 'javascript:alert(1)' },
      { id: 2, state: 'failed', context: { name: 'ok' }, targetUrl: 'http://x.test' },
    ],
  };
  const value = drive(observeFlow(URL_, HEAD), { statuses });
  assert.deepEqual(
    value.checks.map((/** @type {any} */ c) => c.url),
    [null, null],
  );
  assert.equal(value.failures.length, 2);
});
