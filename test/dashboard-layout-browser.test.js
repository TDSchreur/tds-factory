import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

const issue = (n) => `https://github.com/o/r/issues/${n}`;
const checking = run({ id: 'c', column: 'check', title: 'Checking', tickets: [issue(1), issue(2)], ticketsTotal: 2, ticketsDone: 2, standards: 'pass', spec: 'fail', security: 'pass', infrastructure: 'skipped', loops: 2 });
const finished = (i) => run({ id: 'd' + i, column: 'done', status: 'done', title: 'Done run ' + i, pr: 'https://github.com/o/r/pull/' + i, prState: 'open' });
const heights = (selector) => `return [...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => Math.round(e.getBoundingClientRect().height))`;

test('on a phone the ticket links, Show details and Delete are at least 44 px high', async (t) => {
  const page = await openPage(t, { runs: [checking, finished(1)] }, { width: 375 });
  if (!page) return;
  try {
    await page.execute("document.querySelector('.toggle').click()");
    for (const selector of ['.tickets a', '.toggle', '.actions button']) {
      const sizes = await page.execute(heights(selector));
      assert.ok(sizes.length && sizes.every((h) => h >= 44), `${selector}: ${sizes}`);
    }
  } finally { await page.close(); }
});

test('on a desktop the ticket links and Show details keep their compact size', async (t) => {
  const page = await openPage(t, { runs: [checking, finished(1)] });
  if (!page) return;
  try {
    for (const selector of ['.tickets a', '.toggle']) {
      const sizes = await page.execute(heights(selector));
      assert.ok(sizes.length && sizes.every((h) => h < 44), `${selector}: ${sizes}`);
    }
  } finally { await page.close(); }
});
