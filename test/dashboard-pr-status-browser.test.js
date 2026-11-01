import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

const PR = 'https://github.com/o/r/pull/1';
const open = (over = {}) => ({
  state: 'open',
  draft: false,
  checks: { result: 'passing', failing: [] },
  merge: 'mergeable',
  review: 'approved',
  ...over,
});
const status = (page, id) =>
  page.execute(
    `const e = document.querySelector('[data-id=${id}] .pr-status'); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null`,
  );

test('cards show the PR status of an open pull request', async (t) => {
  const runs = [
    run({ id: 'good', title: 'Good', column: 'finish', pr: PR, prStatus: open() }),
    run({
      id: 'bad',
      title: 'Bad',
      column: 'follow-up',
      pr: PR,
      prStatus: open({
        draft: true,
        checks: { result: 'failing', failing: ['Tests', 'lint'] },
        merge: 'conflicting',
        review: 'changes-requested',
      }),
    }),
    run({
      id: 'pending',
      title: 'Pending',
      column: 'finish',
      pr: PR,
      prStatus: open({ checks: { result: 'pending', failing: [] }, merge: 'unknown', review: 'none' }),
    }),
    run({ id: 'waiting-on-gh', title: 'Checking', column: 'finish', pr: PR, prStatus: { checking: true } }),
    run({
      id: 'merged',
      title: 'Merged',
      column: 'done',
      status: 'done',
      pr: PR,
      prState: 'merged',
      prStatus: open({ state: 'merged' }),
    }),
    run({ id: 'none', title: 'None', column: 'build', prStatus: null }),
  ];
  const page = await openPage(t, { runs });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=good]')");
    assert.equal(await status(page, 'good'), 'Pull request Checks: passing Merge: no conflicts Review: approved');
    assert.equal(await page.execute("return document.querySelector('[data-id=good] .pr-status a').href"), PR);
    assert.equal(
      await status(page, 'bad'),
      'Pull request Draft Checks: failing: Tests, lint Merge: conflicts with the base branch Review: changes requested',
    );
    assert.equal(await page.execute("return [...document.querySelectorAll('[data-id=bad] .pr-fact.bad')].length"), 2);
    assert.equal(await status(page, 'pending'), 'Pull request Checks: pending Merge: unknown Review: none yet');
    assert.equal(await status(page, 'waiting-on-gh'), 'Pull request PR status: checking...');
    assert.equal(await page.execute("return document.querySelector('[data-id=merged] .pr-status')"), null);
    assert.equal(await page.execute("return document.querySelector('[data-id=none] .pr-status')"), null);
    await page.execute("document.querySelector('[data-id=good]').click()");
    await page.waitFor("return !!document.querySelector('#detail .pr-status')");
    assert.match(
      await page.execute("return document.querySelector('#detail .pr-status').textContent"),
      /Checks: passing/,
    );
    assert.equal(await page.execute("return document.querySelector('#detail .pr-status a')"), null);
  } finally {
    await page.close();
  }
});

test('an unavailable PR status says why and Check again asks for it again', async (t) => {
  const runs = [
    run({ id: 'a', title: 'A', column: 'finish', pr: PR, prStatus: { unavailable: 'not-signed-in' } }),
    run({ id: 'b', title: 'B', column: 'finish', pr: PR, prStatus: { unavailable: 'weird' } }),
  ];
  const state = { runs };
  const page = await openPage(t, state);
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=a]')");
    assert.match(
      await status(page, 'a'),
      /PR status unavailable: gh is not signed in \(run gh auth login\) Check again$/,
    );
    assert.match(await status(page, 'b'), /PR status unavailable: GitHub could not be read/);
    state.statusReply = () => {
      state.runs = [run({ id: 'a', title: 'A', column: 'finish', pr: PR, prStatus: open() }), state.runs[1]];
    };
    await page.execute("document.querySelector('[data-id=a] .pr-status button').click()");
    await page.waitFor("return /Checks: passing/.test(document.querySelector('[data-id=a]').textContent)");
    assert.deepEqual(state.statusCalls, ['/api/runs/a/pr-status?refresh=1']);
    assert.equal(
      await page.execute("return document.querySelector('#detail').hidden"),
      true,
      'the click does not open the detail',
    );
  } finally {
    await page.close();
  }
});

test('Runs without a prStatus field render as before', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'old', title: 'Old', column: 'finish', pr: PR })] });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=old]')");
    assert.equal(await page.execute("return document.querySelector('[data-id=old] .pr-status')"), null);
  } finally {
    await page.close();
  }
});

test('a mergeable pull request with passing checks shows no red line, and a conflict or failing checks do', async (t) => {
  const runs = [
    run({ id: 'good', title: 'Good', column: 'finish', pr: PR, prStatus: open() }),
    run({
      id: 'conflict',
      title: 'Conflict',
      column: 'finish',
      pr: PR,
      prStatus: open({ merge: 'conflicting' }),
    }),
  ];
  const page = await openPage(t, { runs });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=good]')");
    const lines = (id) =>
      page.execute(
        `return [...document.querySelectorAll('[data-id=${id}] .pr-fact')].map((e) => [e.textContent, e.classList.contains('bad'), getComputedStyle(e).color])`,
      );
    const good = await lines('good');
    assert.deepEqual(
      good.map(([text, bad]) => [text, bad]),
      [
        ['Checks: passing', false],
        ['Merge: no conflicts', false],
        ['Review: approved', false],
      ],
    );
    assert.equal(good[1][2], good[2][2], 'the "no conflicts" line has the colour of the neutral lines');
    const conflict = await lines('conflict');
    assert.deepEqual(
      conflict.map(([text, bad]) => [text, bad]),
      [
        ['Checks: passing', false],
        ['Merge: conflicts with the base branch', true],
        ['Review: approved', false],
      ],
    );
    assert.notEqual(conflict[1][2], conflict[0][2], 'a conflict is shown in the alert colour');
  } finally {
    await page.close();
  }
});
