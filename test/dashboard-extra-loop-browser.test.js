import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

const click = (page, selector) => page.execute(`document.querySelector(${JSON.stringify(selector)}).click()`);
const dialog = (page) => page.execute("return document.getElementById('dialog').open ? [document.getElementById('dialog-title').textContent, document.getElementById('dialog-message').textContent] : null");
const confirmed = async (page, selector, title) => {
  await click(page, selector);
  await page.waitFor(`return document.getElementById('dialog').open && document.getElementById('dialog-title').textContent === ${JSON.stringify(title)}`);
};
const answer = async (page, title) => {
  await click(page, '#dialog-confirm');
  await page.waitFor(`return document.getElementById('dialog').open && document.getElementById('dialog-title').textContent === ${JSON.stringify(title)}`);
  const shown = await dialog(page);
  await click(page, '#dialog-confirm');
  await page.waitFor("return !document.getElementById('dialog').open");
  return shown;
};
const atLimit = (over = {}) => run({ id: 'w', title: 'At the limit', column: 'check', status: 'waiting', waiting: true, loops: 4, loopCap: 4, updated: '2026-11-01T10:00:00.000Z', ...over });
const labels = (page) => page.execute("return [...document.querySelectorAll('[aria-label^=\"Grant an extra Check loop\"]')].map(b => b.getAttribute('aria-label'))");

test('Grant extra loop is offered only to a Run in Check that waits at its limit', async (t) => {
  const page = await openPage(t, { runs: [
    atLimit(),
    atLimit({ id: 'below', title: 'Below', loops: 3 }),
    atLimit({ id: 'running', title: 'Running', status: 'running', waiting: false }),
    atLimit({ id: 'build', title: 'Build', column: 'build' }),
    atLimit({ id: 'raised', title: 'Raised', loopCap: 5 }),
    run({ id: 'old', title: 'Old', column: 'check' }),
  ] });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=w]')");
    assert.deepEqual(await labels(page), ['Grant an extra Check loop to At the limit']);
  } finally { await page.close(); }
});

test('Grant extra loop asks first, posts with the token and the Run time, and reports the result', async (t) => {
  const page = await openPage(t, { runs: [atLimit()] });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=w]')");
    await confirmed(page, '[aria-label^="Grant an extra Check loop"]', 'Grant an extra Check loop?');
    assert.match((await dialog(page))[1], /used its 4 Check loops.*limit to 5.*no ceiling/s);
    await click(page, '#dialog-cancel');
    await page.wait(200);
    assert.deepEqual(page.calls, []);
    await confirmed(page, '[aria-label^="Grant an extra Check loop"]', 'Grant an extra Check loop?');
    assert.deepEqual(await answer(page, 'Extra loop granted'), ['Extra loop granted', 'Extra loop granted.']);
    assert.deepEqual(page.calls, ['POST /api/runs/w/extra-loop?updated=2026-11-01T10%3A00%3A00.000Z']);
    assert.deepEqual(page.tokens, ['test-token']);
  } finally { await page.close(); }
});

test('a refused grant shows the reason', async (t) => {
  const page = await openPage(t, { runs: [atLimit()], respond: () => ({ status: 409, body: 'the Run changed since it was shown' }) });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=w]')");
    await confirmed(page, '[aria-label^="Grant an extra Check loop"]', 'Grant an extra Check loop?');
    assert.deepEqual(await answer(page, 'Could not grant the extra loop'), ['Could not grant the extra loop', 'the Run changed since it was shown']);
  } finally { await page.close(); }
});

test('the detail offers the grant too, and the chip and timeline show the new limit', async (t) => {
  const events = [{ type: 'extra-loop', at: new Date().toISOString(), granted: 1, limit: 5 }];
  const page = await openPage(t, { runs: [atLimit({ loopCap: 5, loops: 5, events }), atLimit({ id: 'raised', title: 'Raised', events })] });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=w]')");
    assert.match(await page.execute("return document.querySelector('[data-id=w] .chips').textContent"), /loop 5\/5/);
    await page.execute("document.querySelector('[data-id=w]').click()");
    await page.waitFor("return !!document.querySelector('#detail .timeline')");
    assert.match(await page.execute("return document.querySelector('#detail .timeline').textContent"), /Extra Check loop granted, limit now 5/);
    assert.equal(await page.execute("return document.querySelectorAll('#detail [aria-label^=\"Grant an extra Check loop\"]').length"), 1);
    await confirmed(page, '#detail [aria-label^="Grant an extra Check loop"]', 'Grant an extra Check loop?');
  } finally { await page.close(); }
});
