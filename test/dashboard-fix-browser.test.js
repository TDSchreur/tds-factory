import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

/** @import { Page } from './browser.js' */

const PR = 'https://github.com/o/r/pull/1';
const DETAILS = {
  state: 'open',
  draft: false,
  conflicts: true,
  failing: [{ name: 'Tests', url: 'https://github.com/o/r/actions/runs/1' }],
  pending: [],
  threads: [{ path: 'a.js', comment: 'rename', url: 'https://github.com/o/r/pull/1#r1' }],
  threadsTotal: 1,
};
const followUp = (/** @type {Record<string, unknown>} */ over = {}) =>
  run({
    id: 'f',
    title: 'Follow one',
    column: 'follow-up',
    pr: PR,
    prHost: 'github',
    loops: 1,
    loopCap: 4,
    updated: '2026-11-01T10:00:00.000Z',
    ...over,
  });
/** @param {Page} page */
const open = async (page) => {
  await page.waitFor("return !!document.querySelector('[data-id=f]')");
  await page.execute('document.querySelector(\'[aria-label^="Check the pull request of"]\').click()');
  await page.waitFor("return !!document.querySelector('#detail .pr-details h4')");
};
/** @param {Page} page */
const fixes = (page) =>
  page.execute(
    "return [...document.querySelectorAll('#detail .fix-button')].map(b => [b.textContent, b.disabled, b.dataset.scope])",
  );
/** @param {Page} page @param {string} title */
const dialogOpen = (page, title) =>
  page.waitFor(
    `return document.getElementById('dialog').open && document.getElementById('dialog-title').textContent === ${JSON.stringify(title)}`,
  );

test('one Fix button per problem of a GitHub pull request, none for Azure DevOps', async (t) => {
  const page = await openPage(t, { runs: [followUp()], detailsBody: DETAILS });
  if (!page) return;
  try {
    await open(page);
    assert.deepEqual(await fixes(page), [
      ['Fix conflicts', false, 'conflicts'],
      ['Fix checks', false, 'checks'],
      ['Fix comments', false, 'comments'],
    ]);
  } finally {
    await page.close();
  }
  const azure = await openPage(t, { runs: [followUp({ prHost: 'azure-devops' })], detailsBody: DETAILS });
  if (!azure) return;
  try {
    await open(azure);
    assert.deepEqual(await fixes(azure), []);
  } finally {
    await azure.close();
  }
});

test('Fix posts the scope and the Run time after a confirmation and shows the result', async (t) => {
  const page = await openPage(t, {
    runs: [followUp()],
    detailsBody: DETAILS,
    respond: () => ({ status: 200, body: 'Follow-up Rework started for checks' }),
  });
  if (!page) return;
  try {
    await open(page);
    await page.execute("document.querySelector('[data-scope=checks]').click()");
    await dialogOpen(page, 'Fix checks?');
    await page.execute("document.getElementById('dialog-confirm').click()");
    await dialogOpen(page, 'Fix started');
    assert.equal(
      await page.execute("return document.getElementById('dialog-message').textContent"),
      'Follow-up Rework started for checks',
    );
    assert.deepEqual(page.calls, [
      'POST /api/projects/p/runs/f/follow-up?scope=checks&updated=2026-11-01T10%3A00%3A00.000Z',
    ]);
    assert.deepEqual(page.tokens, ['test-token']);
  } finally {
    await page.close();
  }
});

test('a refusal is shown with its resolution text', async (t) => {
  const page = await openPage(t, {
    runs: [followUp()],
    detailsBody: DETAILS,
    respond: () => ({ status: 409, body: 'the worktree has uncommitted changes; commit or discard them' }),
  });
  if (!page) return;
  try {
    await open(page);
    await page.execute("document.querySelector('[data-scope=conflicts]').click()");
    await dialogOpen(page, 'Fix conflicts?');
    await page.execute("document.getElementById('dialog-confirm').click()");
    await dialogOpen(page, 'Could not start the Fix');
    assert.match(
      await page.execute("return document.getElementById('dialog-message').textContent"),
      /uncommitted changes; commit or discard/,
    );
    await page.execute("document.getElementById('dialog-confirm').click()");
    await page.waitFor("return !document.getElementById('dialog').open");
    assert.deepEqual(
      (await fixes(page)).map((/** @type {any[]} */ f) => f[1]),
      [false, false, false],
    ); // stays clickable
  } finally {
    await page.close();
  }
});

test('Fix buttons are disabled with a visible reason while a Rework is in progress', async (t) => {
  const page = await openPage(t, { runs: [followUp({ reworkInProgress: true })], detailsBody: DETAILS });
  if (!page) return;
  try {
    await open(page);
    assert.deepEqual(
      (await fixes(page)).map((/** @type {any[]} */ f) => f[1]),
      [true, true, true],
    );
    assert.match(
      await page.execute("return document.querySelector('#detail .fix-reason').textContent"),
      /Follow-up Rework is in progress/,
    );
    assert.equal(
      await page.execute(
        "const b = document.querySelector('#detail .fix-button'); return !!document.getElementById(b.getAttribute('aria-describedby'))",
      ),
      true,
    );
  } finally {
    await page.close();
  }
});

test('at the Check loop limit the button reads Grant extra loop and fix and sends grant=true', async (t) => {
  const page = await openPage(t, { runs: [followUp({ loops: 4, loopCap: 4 })], detailsBody: DETAILS });
  if (!page) return;
  try {
    await open(page);
    assert.equal((await fixes(page))[0][0], 'Grant extra loop and fix');
    await page.execute("document.querySelector('[data-scope=comments]').click()");
    await dialogOpen(page, 'Grant an extra loop and fix?');
    await page.execute("document.getElementById('dialog-confirm').click()");
    await dialogOpen(page, 'Fix started');
    assert.deepEqual(page.calls, [
      'POST /api/projects/p/runs/f/follow-up?scope=comments&updated=2026-11-01T10%3A00%3A00.000Z&grant=true',
    ]);
  } finally {
    await page.close();
  }
});

const ready = () =>
  run({
    id: 'w',
    title: 'Ready one',
    column: 'build',
    status: 'waiting',
    waiting: true,
    reason: 'Follow-up Rework ready for an agent',
    pr: PR,
    prHost: 'github',
  });

test('Copy agent prompt copies the exact text and says so', async (t) => {
  const page = await openPage(t, {
    runs: [ready(), run({ id: 'x', title: 'Other', status: 'waiting', waiting: true })],
  });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=w]')");
    assert.equal(await page.execute("return document.querySelectorAll('.copy-prompt').length"), 1);
    await page.execute(
      "window.copied = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.copied = t; } }, configurable: true }); document.querySelector('[aria-label^=\"Copy agent prompt for\"]').click()",
    );
    await page.waitFor(
      "return window.copied !== null && /Copied/.test(document.querySelector('.copy-status').textContent)",
    );
    assert.equal(await page.execute('return window.copied'), '/factory continue w');
  } finally {
    await page.close();
  }
});

test('without the Clipboard API the prompt is shown selected', async (t) => {
  const page = await openPage(t, { runs: [ready()] });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=w]')");
    await page.execute(
      "Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); document.querySelector('[aria-label^=\"Copy agent prompt for\"]').click()",
    );
    await page.waitFor("return !!document.querySelector('.copy-field')");
    assert.deepEqual(
      await page.execute(
        "const f = document.querySelector('.copy-field'); return [f.value, f.selectionStart, f.selectionEnd]",
      ),
      ['/factory continue w', 0, '/factory continue w'.length],
    );
  } finally {
    await page.close();
  }
});
