import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

/** @import { Page } from './browser.js' */

const REASON = 'Run size over the limit: split the remaining Tickets into a new Run?';
const UPDATED = '2026-11-01T10:00:00.000Z';
/** @param {Page} page @param {string} selector */
const click = (page, selector) => page.execute(`document.querySelector(${JSON.stringify(selector)}).click()`);
/** @param {Page} page */
const dialog = (page) =>
  page.execute(
    "return document.getElementById('dialog').open ? [document.getElementById('dialog-title').textContent, document.getElementById('dialog-message').textContent] : null",
  );
/** @param {Page} page @param {string} title */
const titled = (page, title) =>
  page.waitFor(
    `return document.getElementById('dialog').open && document.getElementById('dialog-title').textContent === ${JSON.stringify(title)}`,
  );
/** @param {Page} page @param {string} title */
const closeAfter = async (page, title) => {
  await titled(page, title);
  const shown = await dialog(page);
  await click(page, '#dialog-confirm');
  await page.waitFor("return !document.getElementById('dialog').open");
  return shown;
};
/** @param {Record<string, unknown>} [over] */
const waiting = (over = {}) =>
  run({
    id: 'w',
    title: 'Too big',
    column: 'build',
    status: 'waiting',
    waiting: true,
    reason: REASON,
    updated: UPDATED,
    ...over,
  });
/** @param {Page} page */
const labels = (page) =>
  page.execute(
    'return [...document.querySelectorAll(\'[aria-label^="Split "], [aria-label^="Continue "]\')].map(b => b.getAttribute(\'aria-label\'))',
  );

test('Split and Continue show only for a readable Run in Build that waits for the size answer', async (t) => {
  const page = await openPage(t, {
    runs: [
      waiting(),
      waiting({ id: 'other', title: 'Other', reason: 'Needs a decision' }),
      waiting({ id: 'check', title: 'Check', column: 'check' }),
      waiting({ id: 'running', title: 'Running', status: 'running', waiting: false }),
      waiting({ id: 'bad', title: 'Bad', unreadable: true }),
    ],
  });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=w]')");
    assert.deepEqual(await labels(page), ['Split Too big', 'Continue Too big']);
    assert.equal(
      await page.execute('return !!document.querySelector(\'.actions button.primary[aria-label$="Too big"]\')'),
      false,
    );
    await page.execute("document.querySelector('[data-id=w]').click()");
    await page.waitFor("return document.getElementById('detail').open");
    assert.deepEqual(
      await page.execute(
        'return [...document.querySelectorAll(\'#detail [aria-label^="Split "], #detail [aria-label^="Continue "]\')].map(b => b.getAttribute(\'aria-label\'))',
      ),
      ['Split Too big', 'Continue Too big'],
    );
  } finally {
    await page.close();
  }
});

test('Continue asks first, sends nothing on Cancel, then posts with the token and the Run time', async (t) => {
  const page = await openPage(t, { runs: [waiting()] });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=w]')");
    await click(page, '[aria-label="Continue Too big"]');
    await titled(page, 'Accept the size and continue Build?');
    assert.match((await dialog(page))[1], /"Too big" goes on in this Run; the size question is not asked again\./);
    assert.equal(
      await page.execute("return document.getElementById('dialog-confirm').classList.contains('danger')"),
      false,
    );
    await click(page, '#dialog-cancel');
    await page.wait(200);
    assert.deepEqual(page.calls, []);
    await click(page, '[aria-label="Continue Too big"]');
    await titled(page, 'Accept the size and continue Build?');
    await click(page, '#dialog-confirm');
    assert.deepEqual(await closeAfter(page, 'Continued'), [
      'Continued',
      'Continued. The agent picks it up on its next step.',
    ]);
    assert.deepEqual(page.calls, ['POST /api/projects/p/runs/w/continue?updated=2026-11-01T10%3A00%3A00.000Z']);
    assert.deepEqual(page.tokens, ['test-token']);
  } finally {
    await page.close();
  }
});

test('a refused Continue shows the server message', async (t) => {
  const page = await openPage(t, {
    runs: [waiting()],
    respond: () => ({ status: 409, body: 'the Run changed since you looked at it; reload and look again' }),
  });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=w]')");
    await click(page, '[aria-label="Continue Too big"]');
    await titled(page, 'Accept the size and continue Build?');
    await click(page, '#dialog-confirm');
    assert.deepEqual(await closeAfter(page, 'Could not continue the Run'), [
      'Could not continue the Run',
      'the Run changed since you looked at it; reload and look again',
    ]);
  } finally {
    await page.close();
  }
});

test('Split sends no request yet', async (t) => {
  const page = await openPage(t, { runs: [waiting()] });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=w]')");
    await click(page, '[aria-label="Split Too big"]');
    await page.wait(200);
    assert.deepEqual(page.calls, []);
  } finally {
    await page.close();
  }
});
