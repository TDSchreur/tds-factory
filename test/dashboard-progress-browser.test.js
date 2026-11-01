import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
const text = (page, id) => page.execute(`return document.querySelector('[data-id=${id}]').textContent`);

test('cards show progress, activity, model and last seen', async (t) => {
  const runs = [
    run({ id: 'live', title: 'Live', activity: 'Writing the helper', ticketsDone: 1, ticketsTotal: 3, model: { requested: 'sonnet', effort: 'high', observed: '' }, lastSeen: minutesAgo(2), status: 'running' }),
    run({ id: 'quiet', title: 'Quiet', lastSeen: minutesAgo(15), updated: minutesAgo(15), status: 'running', model: { requested: 'sonnet', effort: '', observed: 'haiku' } }),
    run({ id: 'asking', title: 'Asking', lastSeen: minutesAgo(40), updated: minutesAgo(40), status: 'waiting', waiting: true, reason: 'Question' }),
    run({ id: 'old', title: 'Old', column: 'define' }),
  ];
  const page = await openPage(t, { runs });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=live]')");
    const live = await text(page, 'live');
    assert.match(live, /Writing the helper/);
    assert.match(live, /Model \(requested\): sonnet, effort high/);
    assert.match(live, /Last seen 2 min ago(?!, quiet)/);
    assert.equal(await page.execute("const b = document.querySelector('[data-id=live] [role=progressbar]'); return b.getAttribute('aria-valuenow') + '/' + b.getAttribute('aria-valuemax')"), '1/3');
    assert.equal(await page.execute("return document.querySelector('[data-id=live] .last-seen').classList.contains('quiet')"), false);
    const quiet = await text(page, 'quiet');
    assert.match(quiet, /Model \(observed\): haiku/);
    assert.doesNotMatch(quiet, /requested/);
    assert.match(quiet, /⚠ Last seen 15 min ago, quiet/);
    assert.equal(await page.execute("return document.querySelector('[data-id=quiet] .last-seen').classList.contains('quiet')"), true);
    assert.doesNotMatch(await text(page, 'asking'), /quiet/);
    assert.match(await text(page, 'asking'), /Last seen 40 min ago/);
    const old = await text(page, 'old');
    assert.doesNotMatch(old, /Model|Last seen/);
    assert.equal(await page.execute("return document.querySelector('[data-id=old] [role=progressbar]')"), null);
  } finally { await page.close(); }
});
