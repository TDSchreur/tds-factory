import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

test('a refresh of the open Run keeps the scroll position of its detail', async (t) => {
  const record = (n) =>
    run({ id: 'r1', title: 'Long run', files: ['define.md'], updated: new Date(Date.now() + n * 1000).toISOString() });
  const page = await openPage(t, {
    runs: [record(0)],
    files: { 'r1/define.md': '# Long\n\n' + Array.from({ length: 150 }, (_, i) => `- finding ${i}`).join('\n') },
  });
  if (!page) return;
  try {
    await page.execute("document.querySelector('.card').click()");
    await page.waitFor("return document.querySelectorAll('#detail li').length > 100");
    await page.execute("document.getElementById('detail').scrollTop = 800");
    for (let n = 1; n <= 3; n++) {
      page.state.runs = [record(n)];
      await page.wait(2300);
    } // each change of `updated` refreshes the open Run
    assert.equal(await page.execute("return Math.round(document.getElementById('detail').scrollTop)"), 800);
  } finally {
    await page.close();
  }
});
