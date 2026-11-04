import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

test('a refresh of the open Run keeps the scroll position of its detail', async (t) => {
  /** @param {number} n */
  const record = (n) =>
    run({ id: 'r1', title: 'Long run', files: ['define.md'], updated: new Date(Date.now() + n * 1000).toISOString() });
  const page = await openPage(
    t,
    {
      runs: [record(0)],
      files: { 'r1/define.md': '# Long\n\n' + Array.from({ length: 150 }, (_, i) => `- finding ${i}`).join('\n') },
    },
    { pollMs: 100 },
  );
  if (!page) return;
  try {
    await page.execute("document.querySelector('.card').click()");
    await page.waitFor(
      "return document.getElementById('detail').open && document.querySelectorAll('#detail li').length > 100",
    );
    await page.execute("document.getElementById('detail').scrollTop = 800");
    for (let n = 1; n <= 3; n++) {
      // Each change of `updated` refreshes the open Run: the next poll brings it and the detail reads its files again.
      await page.waitForFileReads(() => {
        page.state.runs = [record(n)];
      });
    }
    assert.equal(await page.execute("return Math.round(document.getElementById('detail').scrollTop)"), 800);
  } finally {
    await page.close();
  }
});

test('a refresh never opens the modal detail again or moves its focus', async (t) => {
  /** @param {number} n */
  const record = (n) => run({ id: 'r1', title: 'Open run', updated: new Date(Date.now() + n * 1000).toISOString() });
  const page = await openPage(t, { runs: [record(0)] }, { pollMs: 100 });
  if (!page) return;
  try {
    await page.execute(
      "window.__shown = 0; const show = HTMLDialogElement.prototype.showModal; HTMLDialogElement.prototype.showModal = function () { if (this.id === 'detail') window.__shown++; return show.call(this); }",
    );
    await page.execute("document.querySelector('.card').click()");
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')");
    await page.execute("document.querySelector('#detail .close').focus()");
    for (let n = 1; n <= 2; n++) {
      page.state.runs = [record(n)];
      await page.waitForPolls(); // a poll answered after the change, drawn
    }
    assert.equal(await page.execute('return window.__shown'), 1);
    assert.equal(
      await page.execute("return document.activeElement === document.querySelector('#detail .close')"),
      true,
    );
  } finally {
    await page.close();
  }
});
