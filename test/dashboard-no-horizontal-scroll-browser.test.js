import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './browser.js';
import { interpretRun } from '../src/dashboard.js';

/** @import { Run, UsageRow } from '../src/run-record.js' */

const long = 'unbrokenword'.repeat(20);
const model = 'claude-' + 'verylongmodelname'.repeat(5);
/**
 * @param {string} stage
 * @param {Partial<UsageRow>} extra
 * @returns {UsageRow}
 */
const row = (stage, extra = {}) => ({
  stage,
  model,
  ticket: null,
  bucket: null,
  input: 123456789,
  cache_read: 987654321,
  cache_write: 123456789,
  output: 987654321,
  reasoning: null,
  subagent_fresh: 0,
  ...extra,
});
const visits = [
  { stage: 'define', started: '2026-01-01T00:00:00Z', ended: '2026-01-01T00:01:00Z' },
  { stage: 'build', started: '2026-01-01T00:01:00Z' },
];
/**
 * @param {string} id
 * @param {string} title
 */
const entry = (id, title) => {
  /** @type {Run} */
  const record = {
    worktree: '/work',
    title,
    stage: 'build',
    status: 'running',
    tickets: ['https://github.com/o/r/issues/1'],
    tickets_total: 1,
    metrics: {
      version: 1,
      visits,
      verdicts: [],
      usage: {
        status: 'tracked',
        rows: [
          row('define'),
          row('build', { ticket: 1 }),
          row('build', { ticket: 1, model: 'claude-opus-5-5' }),
          row('build', { bucket: 'rework' }),
        ],
      },
    },
  };
  return interpretRun({ id, unreadable: false, record, files: ['define.md'], events: { events: [], damaged: 0 } });
};
const markdown = `# Findings\n\n${long}\n\n| Header | Another |\n| --- | --- |\n| ${long} | ${long} |`;

// The page's scroll width, and every element that scrolls sideways (or clips inside the drawer) and actually overflows, except the Markdown tables' own scroll area and the visually hidden stacked-table header.
const MEASURE = `
  const root = document.scrollingElement;
  const overflowing = [...document.querySelectorAll('*')]
    .filter((el) => {
      const x = getComputedStyle(el).overflowX;
      const clips = /auto|scroll/.test(x) || (/hidden|clip/.test(x) && (el.id === 'detail' || !!el.closest('#detail')));
      return clips && el.scrollWidth > el.clientWidth + 1 && !el.matches('.md .scroll, .usage-table thead');
    })
    .map((el) => el.tagName + '.' + el.className + '#' + el.id);
  return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, overflowing };`;

for (const width of [320, 375, 768, 1024, 1025, 1280, 1440]) {
  test(`nothing scrolls sideways at ${width}px with the Run detail open`, async (t) => {
    const page = await openPage(
      t,
      { runs: [entry('r', 'A'.repeat(150) + ' ' + long), entry('s', 'Second')], files: { 'r/define.md': markdown } },
      { width, height: 800 },
    );
    if (!page) return;
    try {
      await page.waitFor("return !!document.querySelector('[data-id=r]')");
      const closed = await page.execute(MEASURE);
      assert.ok(closed.scrollWidth <= closed.clientWidth, 'board: ' + JSON.stringify(closed));
      assert.deepEqual(closed.overflowing, []);
      await page.execute("document.querySelector('[data-id=r]').click()");
      await page.waitFor(
        "return !!document.querySelector('#detail .md table') && !!document.querySelector('.usage-table')",
      );
      const open = await page.execute(MEASURE);
      assert.ok(open.scrollWidth <= open.clientWidth, 'detail: ' + JSON.stringify(open));
      assert.deepEqual(open.overflowing, []);
    } finally {
      await page.close();
    }
  });
}

test('the usage table has no inner scroll area and keeps its table roles wide and stacked', async (t) => {
  const page = await openPage(
    t,
    { runs: [entry('r', 'Usage run')], files: { 'r/define.md': 'text' } },
    { width: 1200, height: 800 },
  );
  if (!page) return;
  /** Counts the roles the browser exposes for the table. */
  const roles = async () => {
    const { nodes } = await page.cdp('Accessibility.getFullAXTree', {});
    /** @type {Record<string, number>} */
    const count = {};
    for (const node of nodes) {
      const name = node.role?.value;
      if (name) count[name] = (count[name] ?? 0) + 1;
    }
    return count;
  };
  try {
    await page.waitFor("return !!document.querySelector('[data-id=r]')");
    await page.execute("document.querySelector('[data-id=r]').click()");
    await page.waitFor("return !!document.querySelector('.usage-table')");
    assert.equal(await page.execute("return document.querySelector('.usage-table-wrap')"), null);
    assert.equal(await page.execute("return document.querySelector('.usage-table').closest('[tabindex]')"), null);
    const layout = (/** @type {string} */ expected) =>
      page.execute(
        `const t = document.querySelector('.usage-table'), p = t.parentElement.getBoundingClientRect(); return { display: getComputedStyle(t.querySelector('tbody tr')).display, expected: ${JSON.stringify(expected)}, fits: t.getBoundingClientRect().width <= p.width + 1 }`,
      );
    const wide = await layout('table-row');
    assert.equal(wide.display, 'table-row');
    assert.equal(wide.fits, true);
    const wideRoles = await roles();
    assert.equal(wideRoles.table, 1);
    assert.equal(wideRoles.caption, 1);
    assert.equal(wideRoles.columnheader, 8);
    assert.equal(wideRoles.rowheader, 4);
    assert.equal(wideRoles.cell, 28);
    // No column header breaks inside a word at the drawer width of a desktop viewport.
    for (const width of [1025, 1280, 1440]) {
      await page.resize(width, 800);
      const broken = await page.execute(
        `return [...document.querySelectorAll('.usage-table thead th')].filter((th) => {
          if (getComputedStyle(th.closest('tr')).display !== 'table-row') return false;
          const words = th.textContent.trim().split(/\\s+/);
          return words.some((w) => { const r = document.createRange(); const n = th.firstChild; const i = th.textContent.indexOf(w); r.setStart(n, i); r.setEnd(n, i + w.length); return r.getClientRects().length > 1; });
        }).map((th) => th.textContent)`,
      );
      assert.deepEqual(broken, [], 'headers broken at ' + width);
      assert.equal((await layout('table-row')).fits, true, 'fits at ' + width);
    }
    // Below about 44rem of drawer width every row stacks.
    await page.resize(375, 800);
    const narrow = await layout('block');
    assert.equal(narrow.display, 'block');
    assert.equal(narrow.fits, true);
    const narrowRoles = await roles();
    for (const name of ['table', 'caption', 'columnheader', 'rowheader', 'cell'])
      assert.equal(narrowRoles[name], wideRoles[name], name);
    assert.equal(
      await page.execute(
        "const td = document.querySelector('.usage-table tbody td'); return getComputedStyle(td, '::before').content",
      ),
      '"Fresh"',
    );
  } finally {
    await page.close();
  }
});
