import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

test('Follow-up has its own column and opens its summary', async (t) => {
  const entry = run({ id: 'follow', column: 'follow-up', title: 'Review feedback', files: ['follow-up.md'] });
  const page = await openPage(t, { runs: [entry], files: { 'follow/follow-up.md': '# Follow-up\nCI failed' } });
  if (!page) return;
  try {
    assert.equal(await page.execute("return document.querySelector('[data-stage=follow-up]')?.textContent.includes('Review feedback')"), true);
    assert.equal(await page.execute("return document.querySelector('[data-stage=finish]').nextElementSibling.dataset.stage"), 'follow-up');
    await page.execute("document.querySelector('[data-id=follow]').click()");
    await page.waitFor("return document.querySelector('#detail')?.textContent.includes('CI failed')");
  } finally { await page.close(); }
});
