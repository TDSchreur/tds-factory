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

test('the Needs you filter and the waiting-first sort', async (t) => {
  const w = (id, column, minutes) => run({ id, title: id, column, waiting: true, status: 'waiting', reason: 'Q', updated: minutesAgo(1), events: [{ type: 'waiting', at: minutesAgo(minutes) }] });
  const runs = [run({ id: 'busy', column: 'build', updated: minutesAgo(0) }), w('short', 'build', 5), w('long', 'build', 50), run({ id: 'check-busy', column: 'check' })];
  const page = await openPage(t, { runs });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=busy]')");
    const order = "return [...document.querySelectorAll('[data-stage=build] .card')].map((c) => c.dataset.id)";
    assert.deepEqual(await page.execute(order), ['long', 'short', 'busy']);
    assert.equal(await page.execute("return document.title"), '(2) test · TDS Factory');
    assert.equal(await page.execute("const b = document.getElementById('needs-you'); return b.textContent + '|' + b.getAttribute('aria-pressed')"), 'Needs you (2)|false');
    await page.execute("document.getElementById('needs-you').click()");
    await page.waitFor("return document.getElementById('needs-you').getAttribute('aria-pressed') === 'true'");
    assert.deepEqual(await page.execute(order), ['long', 'short']);
    assert.equal(await page.execute("return document.querySelectorAll('.card').length"), 2);
    assert.match(await page.execute("return document.querySelector('[data-stage=check]').textContent"), /No runs waiting on you/);
    assert.equal(await page.execute("return document.title"), '(2) test · TDS Factory');
    await page.execute("document.getElementById('needs-you').click()");
    await page.waitFor("return document.querySelectorAll('.card').length === 4");
  } finally { await page.close(); }
});
