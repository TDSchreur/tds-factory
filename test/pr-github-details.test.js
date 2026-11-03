import { test } from 'node:test';
import assert from 'node:assert/strict';
import { details, setup } from '../src/pr-github.js';

const URL_ = 'https://github.com/o/r/pull/1';
const run =
  (/** @type {any} */ view, /** @type {any} */ threads) =>
  /** @param {string[]} args */
  async (args) => {
    if (args[0] === 'pr') return { stdout: JSON.stringify(view) };
    return { stdout: JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: threads } } } }) };
  };
const page = (/** @type {any[]} */ nodes) => ({ nodes, pageInfo: { hasNextPage: false } });
const check = (/** @type {string} */ name, /** @type {string} */ status, /** @type {string} */ conclusion = '') => ({
  __typename: 'CheckRun',
  name,
  status,
  conclusion,
  detailsUrl: `https://github.com/o/r/runs/${name}`,
});
const thread = (/** @type {string} */ path, /** @type {string} */ body, resolved = false) => ({
  isResolved: resolved,
  path,
  comments: { nodes: [{ body, url: `https://github.com/o/r/pull/1#r-${path}` }] },
});
const open = (/** @type {any} */ extra = {}) => ({
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  statusCheckRollup: [],
  ...extra,
});

test('a passing PR has no failing or pending checks and no threads', async () => {
  const d = await details(URL_, {
    run: run(open({ statusCheckRollup: [check('build', 'COMPLETED', 'SUCCESS')] }), page([])),
  });
  assert.deepEqual(d, {
    state: 'open',
    draft: false,
    conflicts: false,
    failing: [],
    failingTotal: 0,
    pending: [],
    pendingTotal: 0,
    threads: [],
    threadsTotal: 0,
  });
});

test('failing checks carry name and link, pending checks only the name', async () => {
  const d = await details(URL_, {
    run: run(
      open({
        statusCheckRollup: [
          check('lint', 'COMPLETED', 'FAILURE'),
          check('test', 'IN_PROGRESS'),
          { __typename: 'StatusContext', context: 'ci/x', state: 'ERROR', targetUrl: 'https://ci.example/1' },
        ],
      }),
      page([]),
    ),
  });
  assert.deepEqual(d.failing, [
    { name: 'lint', url: 'https://github.com/o/r/runs/lint' },
    { name: 'ci/x', url: 'https://ci.example/1' },
  ]);
  assert.deepEqual(d.pending, ['test']);
});

test('conflicting, draft and unknown merge state', async () => {
  const a = await details(URL_, { run: run(open({ mergeable: 'CONFLICTING', isDraft: true }), page([])) });
  assert.equal(a.conflicts, true);
  assert.equal(a.draft, true);
  const b = await details(URL_, { run: run(open({ mergeable: 'UNKNOWN' }), page([])) });
  assert.equal(b.conflicts, null);
});

test('unresolved threads list path, first comment and link; resolved ones are left out', async () => {
  const d = await details(URL_, { run: run(open(), page([thread('a.js', 'fix this'), thread('b.js', 'done', true)])) });
  assert.deepEqual(d.threads, [{ path: 'a.js', comment: 'fix this', url: 'https://github.com/o/r/pull/1#r-a.js' }]);
  assert.equal(d.threadsTotal, 1);
});

test('merged and closed PRs return just their state and ask for nothing more', async () => {
  /** @type {string[][]} */
  const calls = [];
  for (const [state, expected] of [
    ['MERGED', 'merged'],
    ['CLOSED', 'closed'],
  ]) {
    const d = await details(URL_, {
      run: async (args) => {
        calls.push(args);
        return { stdout: JSON.stringify(open({ state, mergeable: 'CONFLICTING' })) };
      },
    });
    assert.deepEqual(d, { state: expected });
  }
  assert.equal(calls.length, 2, 'no thread query for a PR that is not open');
});

test('hostile text comes back as cut plain strings and a javascript: link is dropped', async () => {
  const long = 'x'.repeat(5000);
  const d = await details(URL_, {
    run: run(
      open({
        statusCheckRollup: [
          { ...check('<img src=x onerror=alert(1)>', 'COMPLETED', 'FAILURE'), detailsUrl: 'javascript:alert(1)' },
        ],
      }),
      page([
        {
          isResolved: false,
          path: `<b>${long}`,
          comments: { nodes: [{ body: `<script>${long}`, url: 'javascript:alert(1)' }] },
        },
      ]),
    ),
  });
  const [failing] = d.failing ?? [];
  const [first] = d.threads ?? [];
  assert.equal(failing.name, '<img src=x onerror=alert(1)>');
  assert.equal(failing.url, null);
  assert.equal(first.url, null);
  assert.ok(first.comment.startsWith('<script>'));
  assert.ok(first.comment.length <= 300);
  assert.ok(first.path.length <= 300);
});

test('a missing or signed-out gh is classified and the host has setup steps', async () => {
  for (const [err, code] of [
    [Object.assign(new Error('x'), { code: 'ENOENT' }), 'gh-missing'],
    [
      Object.assign(new Error('x'), { stderr: 'To get started with GitHub CLI, please run: gh auth login' }),
      'not-signed-in',
    ],
  ]) {
    await assert.rejects(
      details(URL_, {
        run: async () => {
          throw err;
        },
      }),
      (/** @type {any} */ e) => e.code === code && setup.reasons.includes(e.code),
    );
  }
  assert.deepEqual(setup.steps, ['Install the GitHub CLI from https://cli.github.com', 'Run `gh auth login`']);
});

test('a malformed answer is an error, and another host link is refused', async () => {
  await assert.rejects(
    details(URL_, { run: async () => ({ stdout: '[]' }) }),
    (/** @type {any} */ e) => e.code === 'error',
  );
  await assert.rejects(details('https://example.com/x', { run: run(open(), page([])) }));
});

test('control characters and newlines in host text become spaces', async () => {
  const d = await details(URL_, {
    run: run(
      open({ statusCheckRollup: [check('a\nb\u0000c\u001b[31m', 'COMPLETED', 'FAILURE')] }),
      page([thread('p\r\nq', 'line1\nline2\u0007')]),
    ),
  });
  const text = JSON.stringify([d.failing, d.threads]);
  assert.doesNotMatch(String(d.failing?.[0].name), /[\u0000-\u001f\u007f]/);
  assert.doesNotMatch(String(d.threads?.[0].comment), /[\u0000-\u001f\u007f]/);
  assert.doesNotMatch(String(d.threads?.[0].path), /[\u0000-\u001f\u007f]/);
  assert.ok(text.length > 0);
});

test('many threads are capped at 50 and counted, and the page loop stops at 10 pages', async () => {
  const many = Array.from({ length: 100 }, (_, i) => thread(`f${i}`, 'c'));
  const manyOne = await details(URL_, { run: run(open(), page(many)) });
  assert.equal(manyOne.threads?.length, 50);
  assert.equal(manyOne.threadsTotal, 100);
  let graphqlCalls = 0;
  /** @param {string[]} args */
  const endless = async (args) => {
    if (args[0] === 'pr') return { stdout: JSON.stringify(open()) };
    graphqlCalls++;
    return {
      stdout: JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: { nodes: [thread('x', 'c')], pageInfo: { hasNextPage: true, endCursor: 'c' } },
            },
          },
        },
      }),
    };
  };
  const d = await details(URL_, { run: endless });
  assert.equal(graphqlCalls, 10);
  assert.equal(d.threadsTotal, 10);
});

test('a link must be https without whitespace and at most 500 characters', async () => {
  const long = `https://github.com/${'a'.repeat(600)}`;
  const d = await details(URL_, {
    run: run(
      open(),
      page([
        { isResolved: false, path: 'p', comments: { nodes: [{ body: 'c', url: long }] } },
        { isResolved: false, path: 'p', comments: { nodes: [{ body: 'c', url: 'https://x.test/a b' }] } },
      ]),
    ),
  });
  assert.deepEqual(
    d.threads?.map((t) => t.url),
    [null, null],
  );
});

test('C1 controls and bidi or zero-width characters become spaces, and a cut keeps surrogate pairs whole', async () => {
  const hostile = 'a\u0085b\u009fc​d‏e‪f‮g⁦h⁩i';
  const d = await details(URL_, { run: run(open(), page([thread('p', hostile)])) });
  assert.equal(d.threads?.[0].comment, 'a b c d e f g h i');
  const emoji = '😀'.repeat(400);
  const e = await details(URL_, { run: run(open(), page([thread('p', emoji)])) });
  const comment = String(e.threads?.[0].comment);
  assert.ok(comment.length <= 300);
  assert.doesNotMatch(comment, /[\ud800-\udbff](?![\udc00-\udfff])/, 'no lone high surrogate');
  assert.ok(comment.length > 0 && comment.endsWith('😀'));
});

test('a link must parse as an https URL without control characters', async () => {
  const urls = [
    'http://github.com/x',
    'https://',
    'javascript:alert(1)',
    'https://github.com/a\u0085b',
    'https://github.com/a​b',
  ];
  const d = await details(URL_, {
    run: run(
      open(),
      page(urls.map((url) => ({ isResolved: false, path: 'p', comments: { nodes: [{ body: 'c', url }] } }))),
    ),
  });
  assert.deepEqual(
    d.threads?.map((t) => t.url),
    urls.map((u) => (u === 'https://github.com/a​b' ? u : null)),
  );
});

test('failing and pending checks are capped at 50 each and counted', async () => {
  const checks = [
    ...Array.from({ length: 80 }, (_, i) => check(`f${i}`, 'COMPLETED', 'FAILURE')),
    ...Array.from({ length: 70 }, (_, i) => check(`p${i}`, 'IN_PROGRESS')),
  ];
  const d = await details(URL_, { run: run(open({ statusCheckRollup: checks }), page([])) });
  assert.equal(d.failing?.length, 50);
  assert.equal(d.failingTotal, 80);
  assert.equal(d.pending?.length, 50);
  assert.equal(d.pendingTotal, 70);
});
