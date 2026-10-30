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
    let sizes = await page.execute(heights('[data-stage=check] .tickets a, [data-stage=check] .actions button'));
    assert.ok(sizes.length && sizes.every((h) => h >= 44), `Check touch heights: ${sizes}`);
    await page.execute("document.querySelectorAll('.stage-nav button')[4].click()");
    await page.waitFor("return document.querySelector('[data-stage=done]').getBoundingClientRect().height > 0");
    await page.execute("document.querySelector('.toggle').click()");
    for (const selector of ['[data-stage=done] .toggle', '[data-stage=done] .actions button']) {
      sizes = await page.execute(heights(selector));
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

test('every Chip stays on one line, even in a narrow column', async (t) => {
  const page = await openPage(t, { runs: [checking] });
  if (!page) return;
  try {
    const sizes = await page.execute(heights('.chip'));
    assert.equal(sizes.length, 6);
    assert.ok(sizes.every((h) => h < 24), `chip heights: ${sizes}`);
  } finally { await page.close(); }
});

const manyDone = Array.from({ length: 30 }, (_, i) => finished(i));
const metrics = "const c = document.querySelector('[data-stage=done] .cards'); return { scrolls: c.scrollHeight > c.clientHeight + 1, page: document.documentElement.scrollHeight }";

test('on a desktop a long Done column scrolls on its own and keeps the page short', async (t) => {
  const page = await openPage(t, { runs: manyDone });
  if (!page) return;
  try {
    const { scrolls, page: height } = await page.execute(metrics);
    assert.ok(scrolls, 'the Done cards scroll inside their column');
    assert.ok(height < 1100, `page height ${height}`);
  } finally { await page.close(); }
});

test('on a phone the Done column shows every card without its own scroll', async (t) => {
  const page = await openPage(t, { runs: manyDone }, { width: 375 });
  if (!page) return;
  try {
    assert.equal((await page.execute(metrics)).scrolls, false);
  } finally { await page.close(); }
});
