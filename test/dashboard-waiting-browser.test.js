import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
const reason = (page, id) => page.execute(`return document.querySelector('[data-id=${id}] .reason').textContent`);

test('a waiting card carries a Needs you banner with symbol, age and reason', async (t) => {
  const runs = [
    run({ id: 'aged', title: 'Aged', waiting: true, status: 'waiting', reason: 'Question', events: [{ type: 'waiting', at: minutesAgo(12), reason: 'Question' }] }),
    run({ id: 'plain', title: 'Plain', waiting: true, status: 'waiting', reason: 'Confirm', events: [] }),
    run({ id: 'was', title: 'Was', waiting: true, status: 'waiting', reason: 'Again', events: [{ type: 'waiting', at: minutesAgo(30) }, { type: 'released', at: minutesAgo(20) }] }),
    run({ id: 'busy', title: 'Busy' }),
  ];
  const page = await openPage(t, { runs });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=aged]')");
    assert.equal(await reason(page, 'aged'), 'Needs you, waiting 12 min: Question');
    assert.equal(await reason(page, 'plain'), 'Needs you: Confirm');
    assert.equal(await reason(page, 'was'), 'Needs you: Again');
    assert.equal(await page.execute("return getComputedStyle(document.querySelector('[data-id=aged] .reason'), '::before').content.includes('\\u23F8')"), true);
    assert.equal(await page.execute("return getComputedStyle(document.querySelector('[data-id=aged] .reason')).borderLeftWidth"), '4px');
    assert.equal(await page.execute("return document.querySelector('[data-id=busy] .reason')"), null);
    await page.execute("document.querySelector('[data-id=aged]').click()");
    await page.waitFor("return !!document.querySelector('#detail .reason')");
    assert.equal(await page.execute("return document.querySelector('#detail .reason').textContent"), 'Needs you, waiting 12 min: Question');
  } finally { await page.close(); }
});
