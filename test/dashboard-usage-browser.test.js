import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './browser.js';
import { interpretRun } from '../src/dashboard.js';

const row = (stage, model, fields, extra = {}) => ({
  stage,
  model,
  ticket: null,
  bucket: null,
  input: 0,
  cache_read: 0,
  cache_write: 0,
  output: 0,
  reasoning: null,
  subagent_fresh: 0,
  ...fields,
  ...extra,
});
const sonnet = 'claude-sonnet-5-5';
const opus = 'claude-opus-5-5';
const entry = (id, record) =>
  interpretRun({ id, record: { title: id, stage: 'build', status: 'running', ...record }, files: [] });
const visits = [
  { stage: 'define', started: '2026-01-01T00:00:00Z', ended: '2026-01-01T00:01:00Z' },
  { stage: 'build', started: '2026-01-01T00:01:00Z', ended: '2026-01-01T00:02:00Z' },
  { stage: 'check', started: '2026-01-01T00:02:00Z' },
];

test('Ticket tiles show fresh tokens and models, Run detail shows the table, and untracked Runs keep their wording', async (t) => {
  const runs = [
    entry('used', {
      tickets: [
        'https://github.com/o/r/issues/1',
        'https://github.com/o/r/issues/2',
        'https://github.com/o/r/issues/3',
      ],
      tickets_done: 1,
      tickets_total: 3,
      metrics: {
        version: 1,
        visits,
        verdicts: [],
        usage: {
          status: 'tracked',
          rows: [
            row('define', sonnet, { input: 10, cache_read: 1000, cache_write: 100, output: 50 }),
            row('build', sonnet, { input: 100000, cache_read: 5000, cache_write: 40000, output: 8000 }, { ticket: 1 }),
            row('build', opus, { input: 1000, output: 500 }, { ticket: 1 }),
            row('build', sonnet, { input: 1500, output: 500 }, { ticket: 2 }),
            row('build', sonnet, { input: 300, output: 100 }, { bucket: 'rework' }),
          ],
        },
      },
    }),
    entry('plain', {
      tickets: ['https://github.com/o/r/issues/9'],
      tickets_total: 1,
      metrics: { version: 1, visits, verdicts: [], usage: { tokens: 'not tracked', cost: 'not tracked' } },
    }),
  ];
  const page = await openPage(t, { runs });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=used]')");
    const tiles = await page.execute(`return [...document.querySelectorAll('[data-id=used] .ticket')].map((li) => ({
      cls: li.className, text: li.querySelector('.ticket-head').textContent, usage: li.querySelector('.ticket-usage')?.firstElementChild.textContent ?? null }))`);
    assert.equal(tiles.length, 4);
    assert.match(tiles[0].cls, /done/);
    assert.match(tiles[0].text, /#1/);
    assert.equal(tiles[0].usage, '149.5k fresh · sonnet-5-5, opus-5-5');
    assert.match(tiles[1].cls, /active/);
    assert.equal(tiles[1].usage, '2.0k fresh so far · sonnet-5-5');
    assert.equal(tiles[2].usage, null);
    assert.match(tiles[3].cls, /rework/);
    assert.match(tiles[3].text, /Rework/);
    assert.equal(tiles[3].usage, '400 fresh · sonnet-5-5');
    // The usage line sits under the Ticket line, and the breakdown opens on focus.
    const layout = await page.execute(`const li = document.querySelector('[data-id=used] .ticket');
      return { head: li.querySelector('.ticket-head').getBoundingClientRect().bottom, usage: li.querySelector('.ticket-usage').getBoundingClientRect().top,
        hidden: li.querySelector('.usage-breakdown').offsetHeight === 0 }`);
    assert.ok(layout.usage >= layout.head);
    assert.equal(layout.hidden, true);
    await page.execute("document.querySelector('[data-id=used] .ticket-usage').focus()");
    const open = await page.execute(
      `const b = document.querySelector('[data-id=used] .usage-breakdown'); return [b.offsetHeight > 0, b.textContent]`,
    );
    assert.equal(open[0], true);
    assert.match(open[1], /sonnet-5-5.*input 100\.0k.*cache read 5\.0k.*cache write 40\.0k.*output 8\.0k/);
    // On a narrow screen the usage line wraps under the Ticket and the page does not scroll sideways.
    await page.resize(375, 700);
    const narrow = await page.execute(`const li = document.querySelector('[data-id=used] .ticket');
      return { under: li.querySelector('.ticket-usage').getBoundingClientRect().top >= li.querySelector('.ticket-head').getBoundingClientRect().bottom,
        sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth }`);
    assert.equal(narrow.under, true);
    assert.equal(narrow.sideways, false);
    await page.resize(1200, 700);
    // Run detail: the table has the CLI labels and columns.
    await page.execute("document.querySelector('[data-id=used]').click()");
    const table = await page.execute(`const t = document.querySelector('[aria-label="Run metrics"] table');
      return t && { caption: t.caption.textContent, heads: [...t.querySelectorAll('th[scope=col]')].map((h) => h.textContent), text: t.textContent }`);
    assert.ok(table, 'the Run detail has a usage table');
    assert.match(table.caption, /Token usage/);
    assert.deepEqual(table.heads, [
      'Where',
      'Fresh',
      'Input',
      'Cache read',
      'Cache write',
      'Output',
      'Reasoning',
      'Subagents',
    ]);
    assert.match(table.text, /Define · claude-sonnet-5-5/);
    assert.match(
      await page.execute('return document.querySelector(\'[aria-label="Run metrics"]\').textContent'),
      /Check · no data/,
    );
    assert.match(table.text, /Build · Ticket 1 · claude-opus-5-5/);
    assert.match(table.text, /Build · Rework · claude-sonnet-5-5/);
    assert.match(
      await page.execute('return document.querySelector(\'[aria-label="Run metrics"]\').textContent'),
      /Tokens: 152\.1k fresh/,
    );
    // An untracked Run keeps today's wording and shows no usage line or table.
    assert.equal(await page.execute("return document.querySelectorAll('[data-id=plain] .ticket-usage').length"), 0);
    await page.execute("document.querySelector('[data-id=plain]').click()");
    const plain = await page.execute('return document.querySelector(\'[aria-label="Run metrics"]\')');
    assert.ok(plain);
    assert.match(
      await page.execute('return document.querySelector(\'[aria-label="Run metrics"]\').textContent'),
      /Tokens: not tracked/,
    );
    assert.equal(
      await page.execute('return document.querySelectorAll(\'[aria-label="Run metrics"] table\').length'),
      0,
    );
  } finally {
    await page.close();
  }
});
