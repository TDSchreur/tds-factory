import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

/**
 * The text of the constants file as the page gets it.
 * @param {import('./browser.js').Page} page
 * @returns {Promise<string>}
 */
const modelText = async (page) =>
  (await page.cdp('Runtime.evaluate', { expression: "fetch('/model.js').then((r) => r.text())", awaitPromise: true }))
    .result.value;

test('without pollMs the page gets the Dashboard as shipped, polling every 2000 ms', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'r1', title: 'One' })] });
  if (!page) return;
  try {
    assert.match(await modelText(page), /^export const POLL_MS = 2000;$/m);
  } finally {
    await page.close();
  }
});

test('with pollMs the page gets that interval and polls at it', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'r1', title: 'One' })] }, { pollMs: 100 });
  if (!page) return;
  try {
    assert.match(await modelText(page), /^export const POLL_MS = 100;$/m);
    // Three answers at 100 ms are a fraction of a second; at 2000 ms they would need over four seconds.
    await page.waitForPolls(3);
  } finally {
    await page.close();
  }
});

test('after waitForPolls the page shows what the poll brought, with no further wait', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'r1', title: 'Title 0' })] }, { pollMs: 100 });
  if (!page) return;
  try {
    for (let n = 1; n <= 10; n++) {
      page.state.runs = [run({ id: 'r1', title: `Title ${n}` })];
      await page.waitForPolls();
      assert.equal(
        await page.execute(
          "return document.querySelector('.card h3, .card .title, .card')?.textContent.includes(arguments[0])",
          [`Title ${n}`],
        ),
        true,
        `the card shows Title ${n} right after the poll`,
      );
    }
  } finally {
    await page.close();
  }
});
