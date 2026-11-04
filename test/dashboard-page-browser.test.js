import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';
import { waitUntil } from './wait-until.js';

/** @import { Page, RunStub } from './browser.js' */

const ESCAPE = '\uE00C';

// The dialog closes before its request reaches the server, so wait for the call instead of racing it.
/**
 * @param {Page} page
 * @param {number} count
 */
async function waitForCalls(page, count) {
  await waitUntil(() => page.calls.length >= count, { message: `${count} calls recorded` });
}

test('the board explains itself and flags Runs that wait on the user', async (t) => {
  const page = await openPage(t, {
    runs: [
      run({
        id: 'a',
        title: 'Active',
        column: 'check',
        ticketsTotal: 2,
        ticketsDone: 1,
        standards: 'pass',
        spec: 'pass',
        security: 'fail',
        infrastructure: 'skipped',
        loops: 1,
      }),
      run({ id: 'w', title: 'Waiting', waiting: true, reason: 'confirm the plan' }),
    ],
  });
  if (!page) return;
  try {
    assert.equal(await page.execute("return document.getElementById('help').textContent"), 'Help');
    assert.deepEqual(
      await page.execute(
        "return [...document.querySelectorAll('.stage-headers h2')].map(h => [h.textContent, h.tabIndex, h.title.length > 20])",
      ),
      ['Define', 'Build', 'Check', 'Finish', 'Follow-up', 'Done'].map((label) => [label, 0, true]),
    );
    assert.deepEqual(
      await page.execute(
        "return [...document.querySelectorAll('[data-stage=check] ul.chips > li.chip')].map(c => [c.querySelector('.chip-icon').textContent, c.querySelector('.chip-label').textContent, c.querySelector('.chip-value').textContent, c.className, c.title.length > 10])",
      ),
      [
        ['▣', 'Tickets', '1/2', 'chip accent', true],
        ['✓', 'Standards', 'pass', 'chip pass', true],
        ['✓', 'Spec', 'pass', 'chip pass', true],
        ['✗', 'Security', 'fail', 'chip fail', true],
        ['⊘', 'Infrastructure', 'skipped', 'chip skipped', true],
        ['↻', 'Check loops', '1/4', 'chip neutral', true],
      ],
    );
    assert.equal(
      await page.execute("return document.querySelector('.card.waiting .reason').textContent"),
      'Needs you: confirm the plan',
    );
    assert.equal(await page.execute('return document.title'), '(1) test · TDS Factory');
    assert.equal(await page.execute("return document.querySelector('[data-stage=prepare]')"), null);
    assert.equal(
      await page.execute("return ['project', 'status', 'theme', 'older'].every(id => document.getElementById(id))"),
      true,
    );
    assert.equal(await page.execute("return document.getElementById('project').textContent"), 'test');
  } finally {
    await page.close();
  }
});

test('older Runs are folded, except those waiting on the user', async (t) => {
  const page = await openPage(t, {
    runs: [
      run({ id: 'new', title: 'New' }),
      run({ id: 'old', title: 'Old', updated: '2020-01-01T00:00:00Z' }),
      run({ id: 'oldw', title: 'Old waiting', updated: '2020-01-01T00:00:00Z', waiting: true }),
    ],
  });
  if (!page) return;
  try {
    const titles = "return [...document.querySelectorAll('.card .title')].map(e => e.textContent).sort()";
    assert.deepEqual(await page.execute(titles), ['New', 'Old waiting']);
    assert.equal(await page.execute("return document.getElementById('older').textContent"), 'Show older (1)');
    await page.execute("document.getElementById('older').click()");
    assert.deepEqual(await page.execute(titles), ['New', 'Old', 'Old waiting']);
    assert.equal(await page.execute("return document.getElementById('older').textContent"), 'Hide older runs');
  } finally {
    await page.close();
  }
});

test('Done cards start collapsed, expand in place and stay expanded after a refresh', async (t) => {
  /** @param {Partial<RunStub>} over */
  const done = (over) => run({ column: 'done', status: 'done', agent: 'claude', standards: 'pass', ...over });
  const page = await openPage(
    t,
    {
      runs: [
        done({ id: 'd', title: 'Done run' }),
        done({ id: '__proto__', title: 'Proto run' }),
        done({ id: 'x', title: 'Stopped', status: 'abandoned' }),
        run({ id: 'a', title: 'Active', agent: 'codex', standards: 'pass' }),
      ],
    },
    { pollMs: 100 },
  );
  if (!page) return;
  try {
    /** @param {string} title */
    const hidden = (title) =>
      page.execute(
        `return [...document.querySelectorAll('.card')].find(c => c.querySelector('.title').textContent === '${title}').querySelector('.details').hidden`,
      );
    assert.equal(await hidden('Done run'), true);
    assert.equal(await hidden('Proto run'), true);
    assert.equal(
      await page.execute(
        "return document.querySelector('[data-stage=build] .chips .chip') !== null && !document.querySelector('[data-stage=build] .details')",
      ),
      true,
    );
    assert.match(
      await page.execute(
        "return [...document.querySelectorAll('.card')].find(c => c.textContent.includes('Stopped')).textContent",
      ),
      /Abandoned/,
    );
    await page.execute('document.querySelector(\'[aria-label="Show details: Done run"]\').click()');
    assert.equal(await hidden('Done run'), false);
    assert.equal(await page.execute("return !document.querySelector('.card.selected')"), true);
    assert.equal(
      await page.execute(
        "return document.querySelector('[aria-label=\"Hide details: Done run\"]').getAttribute('aria-expanded')",
      ),
      'true',
    );
    await page.waitForPolls();
    assert.equal(await hidden('Done run'), false);
    assert.equal(await hidden('Proto run'), true);
  } finally {
    await page.close();
  }
});

test('a Done card shows the PR state and offers no Merge button or note', async (t) => {
  /**
   * @param {string} id
   * @param {string} prState
   */
  const done = (id, prState) =>
    run({ id, title: id, column: 'done', status: 'done', pr: 'https://github.com/a/b/pull/1', prState });
  const page = await openPage(t, { runs: [done('open', 'open'), done('merged', 'merged')] });
  if (!page) return;
  try {
    await page.execute("document.querySelectorAll('.card [aria-expanded]').forEach(b => b.click())");
    assert.deepEqual(await page.execute("return [...document.querySelectorAll('.pr')].map(p => p.textContent)"), [
      'Pull request Merged',
      'Pull request Open',
    ]);
    assert.equal(await page.execute("return document.querySelector('.pr a').href"), 'https://github.com/a/b/pull/1');
    assert.equal(
      await page.execute(
        "return [...document.querySelectorAll('.card button')].filter(b => /^merge$|squash and merge/i.test(b.textContent + ' ' + b.getAttribute('aria-label'))).length",
      ),
      0,
    );
    assert.equal(await page.execute("return document.querySelector('.merge-note')"), null);
    assert.deepEqual(page.calls, []);
  } finally {
    await page.close();
  }
});

test('active Runs offer deletion and dirty changes need separate confirmation', async (t) => {
  const page = await openPage(t, {
    runs: ['define', 'build', 'check', 'finish'].map((column) => run({ id: column, title: column, column })),
    respond: (req) =>
      req.url?.includes('discardChanges=true')
        ? { status: 200, body: 'deleted' }
        : { status: 409, body: 'dirty', headers: { 'x-factory-error': 'dirty-worktree' } },
  });
  if (!page) return;
  try {
    assert.equal(await page.execute("return document.querySelectorAll('.card .actions .danger').length"), 4);
    await page.execute("document.querySelector('[data-id=build] .danger').click()");
    await page.waitFor("return document.getElementById('dialog').open");
    assert.match(await page.execute("return document.getElementById('dialog-message').textContent"), /stop.*agent/i);
    await page.execute("document.getElementById('dialog-confirm').click()");
    await page.waitFor(
      "return document.getElementById('dialog').open && document.getElementById('dialog-title').textContent === 'Discard uncommitted changes?'",
    );
    assert.match(
      await page.execute("return document.getElementById('dialog-message').textContent"),
      /build.*permanently.*worktree/i,
    );
    await page.execute("document.getElementById('dialog-cancel').click()");
    assert.deepEqual(page.calls, ['DELETE /api/projects/p/runs/build']);
    await page.execute("document.querySelector('[data-id=build] .danger').click()");
    await page.waitFor("return document.getElementById('dialog').open");
    await page.execute("document.getElementById('dialog-confirm').click()");
    await page.waitFor(
      "return document.getElementById('dialog').open && document.getElementById('dialog-title').textContent === 'Discard uncommitted changes?'",
    );
    await page.execute("document.getElementById('dialog-confirm').click()");
    await page.waitFor("return !document.getElementById('dialog').open");
    await waitForCalls(page, 3);
    assert.deepEqual(page.calls, [
      'DELETE /api/projects/p/runs/build',
      'DELETE /api/projects/p/runs/build',
      'DELETE /api/projects/p/runs/build?discardChanges=true',
    ]);
  } finally {
    await page.close();
  }
});

test('Delete all asks separately before discarding each dirty Run', async (t) => {
  const page = await openPage(t, {
    runs: ['a', 'b'].map((id) => run({ id, title: id, column: 'done', status: 'done' })),
    respond: (req) =>
      req.url?.includes('discardChanges=true')
        ? { status: 200, body: 'deleted' }
        : { status: 409, body: 'dirty', headers: { 'x-factory-error': 'dirty-worktree' } },
  });
  if (!page) return;
  try {
    await page.execute("[...document.querySelectorAll('button')].find(b => b.textContent === 'Delete all').click()");
    await page.waitFor("return document.getElementById('dialog').open");
    await page.execute("document.getElementById('dialog-confirm').click()");
    await page.waitFor(
      "return document.getElementById('dialog').open && document.getElementById('dialog-title').textContent === 'Discard uncommitted changes?'",
    );
    const first = await page.execute("return document.getElementById('dialog-message').textContent");
    await page.execute("document.getElementById('dialog-cancel').click()");
    await page.waitFor(
      "return document.getElementById('dialog').open && document.getElementById('dialog-title').textContent === 'Discard uncommitted changes?' && document.getElementById('dialog-message').textContent !== " +
        JSON.stringify(first),
    );
    await page.execute("document.getElementById('dialog-confirm').click()");
    await page.waitFor("return !document.getElementById('dialog').open");
    await waitForCalls(page, 3);
    assert.equal(page.calls.length, 3);
    assert.equal(page.calls.filter((call) => call.includes('discardChanges=true')).length, 1);
    assert.equal(page.calls.filter((call) => !call.includes('discardChanges=true')).length, 2);
  } finally {
    await page.close();
  }
});

test('Delete all names the hidden older Runs and reports the Runs that fail', async (t) => {
  /**
   * @param {string} id
   * @param {Partial<RunStub>} [over]
   */
  const done = (id, over) => run({ id, title: id, column: 'done', status: 'done', ...over });
  const page = await openPage(t, {
    runs: [done('new'), done('old', { updated: '2020-01-01T00:00:00Z' }), run({ id: 'active', title: 'active' })],
    respond: (req) =>
      req.url?.startsWith('/api/projects/p/runs/old')
        ? { status: 409, body: 'refused' }
        : { status: 200, body: 'deleted' },
  });
  if (!page) return;
  try {
    await page.execute("[...document.querySelectorAll('button')].find(b => b.textContent === 'Delete all').click()");
    await page.waitFor("return document.getElementById('dialog').open");
    assert.match(
      await page.execute("return document.getElementById('dialog-message').textContent"),
      /2 Done Runs.*hidden older Runs/,
    );
    await page.execute("document.getElementById('dialog-cancel').click()");
    assert.deepEqual(page.calls, []);
    await page.execute("[...document.querySelectorAll('button')].find(b => b.textContent === 'Delete all').click()");
    await page.waitFor("return document.getElementById('dialog').open");
    await page.execute("document.getElementById('dialog-confirm').click()");
    await page.waitFor(
      "return document.getElementById('dialog').open && document.getElementById('dialog-title').textContent === 'Could not delete'",
    );
    assert.equal(await page.execute("return document.getElementById('dialog-message').textContent"), 'old (refused)');
    assert.equal(await page.execute("return document.getElementById('dialog-cancel').hidden"), true);
    assert.deepEqual(page.calls.sort(), [
      'DELETE /api/projects/p/runs/new?doneOnly=true',
      'DELETE /api/projects/p/runs/old?doneOnly=true',
    ]);
  } finally {
    await page.close();
  }
});

test('selecting a Run shows its Markdown files as text, never as markup', async (t) => {
  const page = await openPage(t, {
    runs: [
      run({
        id: 'r1',
        title: 'With files',
        files: ['define.md', 'build.md'],
        links: [
          { label: 'Spec', href: 'docs/specs/x.md' },
          { label: 'PR', href: 'https://example.com/pr/1' },
        ],
      }),
      run({ id: 'r2', title: 'Bare' }),
    ],
    files: {
      'r1/define.md':
        '# Plan\n\n- one\n- two with `code`\n\n<img src=x onerror="document.title=\'pwned\'">\n\n[ok](https://example.com) [bad](javascript:alert(1))',
      'r1/build.md': '| a | b |\n|---|---|\n| 1 | 2 |',
    },
  });
  if (!page) return;
  try {
    await page.execute("document.querySelector('[data-id=r1]').click()");
    await page.waitFor(
      "return document.getElementById('detail').open && document.querySelectorAll('#detail table td').length === 2",
    );
    assert.equal(await page.execute("return document.querySelector('#detail h4').textContent"), 'Plan');
    assert.equal(await page.execute("return document.querySelectorAll('#detail li').length"), 2);
    assert.equal(
      await page.execute(
        "return document.querySelector('#detail img') === null && document.title === 'test · TDS Factory'",
      ),
      true,
    );
    assert.deepEqual(await page.execute("return [...document.querySelectorAll('#detail a')].map(a => a.href)"), [
      'https://example.com/pr/1',
      'https://example.com/',
    ]);
    assert.match(await page.execute("return document.querySelector('#detail').textContent"), /Spec: x\.md/);
    assert.equal(
      await page.execute("return document.querySelector('#detail button.doc-link').title"),
      'docs/specs/x.md',
    );
    await page.execute("document.querySelector('[data-id=r2]').click()");
    assert.match(await page.execute("return document.querySelector('#detail').textContent"), /No summaries yet/);
    await page.execute("document.querySelector('[data-id=r2]').click()");
    assert.equal(await page.execute("return document.getElementById('detail').hidden"), true);
  } finally {
    await page.close();
  }
});

test('the Run detail opens as a drawer over a board that keeps its width', async (t) => {
  const many = Array.from({ length: 12 }, (_, i) =>
    run({
      id: 'b' + i,
      title: 'Run ' + i,
      column: 'build',
      updated: new Date(Date.now() - i * 1000).toISOString(),
      files: ['define.md'],
    }),
  );
  const page = await openPage(t, {
    runs: many,
    files: { 'b11/define.md': '# Last\n\ntext', 'b0/define.md': '# First\n\ntext' },
  });
  if (!page) return;
  try {
    const columns = () =>
      page.execute(
        "return [...document.querySelectorAll('.column')].map(c => { const r = c.getBoundingClientRect(); return [r.left, r.width]; })",
      );
    const before = await columns();
    await page.execute(
      "document.querySelector('[data-id=b11]').scrollIntoView(); document.querySelector('[data-id=b11]').click()",
    );
    await page.waitFor(
      "return document.querySelector('#detail h4') !== null && document.getElementById('detail').open",
    );
    assert.deepEqual(await columns(), before, 'the board does not move or shrink');
    const box = await page.execute(
      "const d = document.getElementById('detail').getBoundingClientRect(); return { open: document.getElementById('detail').open, dRight: d.right, vw: document.documentElement.clientWidth, dTop: d.top, dBottom: d.bottom, w: innerWidth, h: innerHeight, dWidth: d.width }",
    );
    assert.equal(box.open, true);
    assert.ok(box.dRight >= box.vw - 1, 'the drawer sits on the right edge');
    assert.ok(box.dWidth <= 896 + 1 && box.dWidth < box.w, 'the drawer is a sheet, not the whole screen');
    assert.ok(box.dTop >= 0 && box.dBottom <= box.h + 1, 'the drawer is in view');
    assert.equal(
      await page.execute("return document.querySelector('[data-id=b11]').classList.contains('selected')"),
      true,
    );
    // The board behind the drawer is not reachable; the close button closes it and leaves only the board.
    assert.equal(
      await page.execute(
        "const r = document.querySelector('[data-id=b0]').getBoundingClientRect(); return !!document.elementFromPoint(r.left + 5, r.top + 5)?.closest('.card')",
      ),
      false,
    );
    await page.execute('document.querySelector(\'#detail button[aria-label="Close Run detail"]\').click()');
    await page.waitFor("return document.getElementById('detail').hidden");
    assert.equal(await page.execute("return document.querySelector('.card.selected')"), null);
    // Another card opens its own detail once the first is closed.
    await page.execute("document.querySelector('[data-id=b0]').click()");
    await page.waitFor(
      "return document.getElementById('detail').open && document.querySelector('#detail h4')?.textContent === 'First'",
    );
    assert.equal(await page.execute("return document.querySelector('#detail h2').textContent"), 'Run 0');
  } finally {
    await page.close();
  }
});

test('the Run detail header shows the Run state and stays in view while the summaries scroll', async (t) => {
  const page = await openPage(t, {
    runs: [
      run({
        id: 'w',
        title: 'Waiting run',
        column: 'check',
        waiting: true,
        reason: 'confirm the plan',
        agent: 'claude',
        ticketsTotal: 2,
        ticketsDone: 1,
        standards: 'pass',
        files: ['define.md'],
        links: [{ label: 'Spec', href: 'docs/specs/x.md' }],
      }),
      run({ id: 'x', title: 'Dropped', column: 'done', status: 'abandoned' }),
    ],
    files: { 'w/define.md': '# Long\n\n' + Array.from({ length: 150 }, (_, i) => `- finding ${i}`).join('\n') },
  });
  if (!page) return;
  try {
    await page.execute("document.querySelector('[data-id=w]').click()");
    await page.waitFor(
      "return document.getElementById('detail').open && document.querySelectorAll('#detail li').length > 100",
    );
    const head = await page.execute("return document.querySelector('#detail header').textContent");
    for (const part of [
      'Waiting run',
      'Check',
      'Needs you: confirm the plan',
      'Tickets 1/2',
      'Standards pass',
      'claude',
      'Updated',
    ])
      assert.ok(head.includes(part), part + ' in ' + head);
    assert.equal(
      await page.execute(
        "const b = document.querySelector('#detail header button[aria-label=\"Close Run detail\"]').getBoundingClientRect(); return document.getElementById('detail').getBoundingClientRect().right - b.right < 40",
      ),
      true,
    ); // at the right edge
    await page.execute("document.getElementById('detail').scrollTop = 600");
    const gap = await page.execute(
      "return document.querySelector('#detail header').getBoundingClientRect().top - document.getElementById('detail').getBoundingClientRect().top",
    );
    assert.ok(Math.abs(gap) <= 2, 'the header stays at the top of the Run detail, gap ' + gap);
    await page.execute("document.querySelector('[data-id=x]').click()");
    assert.match(await page.execute("return document.querySelector('#detail header').textContent"), /Done.*Abandoned/s);
  } finally {
    await page.close();
  }
});

test('the Run detail is keyboard friendly: focus moves in, Escape closes it and focus returns to the card', async (t) => {
  const page = await openPage(
    t,
    {
      runs: [run({ id: 'r1', title: 'One', files: ['define.md'] }), run({ id: 'r2', title: 'Two' })],
      files: { 'r1/define.md': 'text' },
    },
    { pollMs: 100 },
  );
  if (!page) return;
  try {
    assert.equal(
      await page.execute("return document.getElementById('detail').getAttribute('aria-label')"),
      'Run detail',
    );
    await page.execute(
      "document.querySelector('[data-id=r1]').focus(); document.querySelector('[data-id=r1]').click()",
    );
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')");
    await page.waitForPolls(); // a poll must not take focus away again
    await page.execute("document.querySelector('#detail a, #detail button').focus()");
    await page.waitForPolls();
    assert.equal(await page.execute("return document.activeElement.closest('#detail') !== null"), true);
    await page.key(ESCAPE);
    await page.waitFor("return document.getElementById('detail').hidden");
    assert.equal(await page.execute("return document.activeElement === document.querySelector('[data-id=r1]')"), true);
    // Escape with nothing open does nothing.
    await page.key(ESCAPE);
    assert.equal(await page.execute("return document.getElementById('detail').hidden"), true);
    // The close button hands focus back to the card too.
    await page.execute("document.querySelector('[data-id=r1]').click()");
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')");
    await page.execute('document.querySelector(\'#detail button[aria-label="Close Run detail"]\').click()');
    await page.waitFor("return document.activeElement === document.querySelector('[data-id=r1]')");
  } finally {
    await page.close();
  }
});

test('on a narrow screen the Run detail is a full-screen sheet with Back navigation', async (t) => {
  const page = await openPage(
    t,
    { runs: [run({ id: 'r1', title: 'One', files: ['define.md'] })], files: { 'r1/define.md': 'text' } },
    { width: 500 },
  );
  if (!page) return;
  try {
    await page.execute("document.querySelector('[data-id=r1]').click()");
    // The dialog loses `hidden` when it renders and opens a moment later, so wait for it to be open.
    await page.waitFor("return document.getElementById('detail').open");
    const box = await page.execute(
      "const d = document.getElementById('detail').getBoundingClientRect(); return { l: d.left, t: d.top, w: d.width, h: d.height, vw: innerWidth, vh: innerHeight }",
    );
    assert.ok(
      box.l <= 1 && box.t <= 1 && box.w >= box.vw - 20 && box.h >= box.vh - 1,
      'the sheet covers the screen: ' + JSON.stringify(box),
    );
    await page.execute(
      "[...document.querySelectorAll('#detail button')].find(b => /Back to stages/.test(b.textContent)).click()",
    );
    await page.waitFor("return document.getElementById('detail').hidden");
    assert.equal(
      await page.execute(
        "const c = document.querySelector('[data-id=r1]').getBoundingClientRect(); return c.width > 0 && c.top < innerHeight",
      ),
      true,
    );
  } finally {
    await page.close();
  }
});

test('switching to another Run opens its detail at the top', async (t) => {
  const long = '# Long\n\n' + Array.from({ length: 150 }, (_, i) => `- finding ${i}`).join('\n');
  const page = await openPage(t, {
    runs: [run({ id: 'a', title: 'A', files: ['define.md'] }), run({ id: 'b', title: 'B', files: ['define.md'] })],
    files: { 'a/define.md': long, 'b/define.md': long },
  });
  if (!page) return;
  try {
    await page.execute("document.querySelector('[data-id=a]').click()");
    await page.waitFor(
      "return document.getElementById('detail').open && document.querySelectorAll('#detail li').length > 100",
    );
    await page.execute("document.getElementById('detail').scrollTop = 800");
    await page.execute("document.querySelector('[data-id=b]').click()");
    await page.waitFor(
      "return document.getElementById('detail').open && document.querySelector('#detail h2').textContent === 'B'",
    );
    assert.equal(await page.execute("return document.getElementById('detail').scrollTop"), 0);
  } finally {
    await page.close();
  }
});

test('the Run detail closes when its Run is no longer shown', async (t) => {
  const page = await openPage(
    t,
    { runs: [run({ id: 'r1', title: 'Going' }), run({ id: 'r2', title: 'Staying' })] },
    { pollMs: 100 },
  );
  if (!page) return;
  try {
    await page.execute("document.querySelector('[data-id=r1]').click()");
    await page.waitFor("return document.getElementById('detail').open");
    page.state.runs = [run({ id: 'r2', title: 'Staying' })];
    await page.waitForPolls();
    assert.equal(await page.execute("return document.getElementById('detail').hidden"), true);
    page.state.runs = [run({ id: 'r1', title: 'Going' }), run({ id: 'r2', title: 'Staying' })];
    await page.waitForPolls();
    assert.equal(await page.execute("return document.getElementById('detail').hidden"), true); // it does not reopen by itself
  } finally {
    await page.close();
  }
});

test('a failed refresh keeps the last data and says so', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'r', title: 'Kept' })] }, { pollMs: 100 });
  if (!page) return;
  try {
    page.state.failViews = true;
    await page.waitFor("return document.getElementById('status').className === 'error'");
    assert.match(
      await page.execute("return document.getElementById('status').textContent"),
      /Cannot reach the server \(HTTP 500\).*showing last data/,
    );
    assert.equal(await page.execute("return document.querySelectorAll('.card').length"), 1);
    page.state.failViews = false;
    await page.waitFor(
      "return document.getElementById('status').className === '' && /^Updated/.test(document.getElementById('status').textContent)",
    );
  } finally {
    await page.close();
  }
});

test('card buttons are visibly distinct: filled Accept Check, warning Delete, link-style toggle', async (t) => {
  const page = await openPage(t, {
    runs: [
      run({
        id: 'o',
        title: 'Open',
        column: 'check',
        status: 'waiting',
        waiting: true,
        pr: 'https://github.com/o/r/pull/1',
        prState: 'open',
      }),
    ],
  });
  if (!page) return;
  try {
    /**
     * @param {string} sel
     * @param {string} prop
     */
    const css = (sel, prop) => page.execute(`return getComputedStyle(document.querySelector('${sel}')).${prop}`);
    const [merge, del, card] = [
      await css('.actions .primary', 'backgroundColor'),
      await css('.actions .danger', 'color'),
      await css('.card', 'backgroundColor'),
    ];
    assert.notEqual(merge, card);
    assert.notEqual(merge, await css('.actions .danger', 'backgroundColor'));
    assert.notEqual(del, await css('.card', 'color'));
    assert.equal(await page.execute("return document.querySelector('.meta .updated') !== null"), true);
  } finally {
    await page.close();
  }
});

test('a collapsed Done card with an open pull request shows an Open PR badge', async (t) => {
  const page = await openPage(t, {
    runs: [
      run({
        id: 'o',
        title: 'Open one',
        column: 'done',
        status: 'done',
        pr: 'https://github.com/o/r/pull/1',
        prState: 'open',
      }),
      run({
        id: 'm',
        title: 'Merged one',
        column: 'done',
        status: 'done',
        pr: 'https://github.com/o/r/pull/2',
        prState: 'merged',
      }),
    ],
  });
  if (!page) return;
  try {
    /** @param {string} title */
    const badge = (title) =>
      page.execute(
        `const c = [...document.querySelectorAll('.card')].find(c => c.querySelector('.title').textContent === '${title}'); const b = c.querySelector('.open-pr'); return b ? [b.textContent, c.querySelector('.details').hidden] : null`,
      );
    assert.deepEqual(await badge('Open one'), ['Open PR', true]);
    assert.equal(await badge('Merged one'), null);
  } finally {
    await page.close();
  }
});

test('cards and detail distinguish paused Runs from waiting on a person', async (t) => {
  const page = await openPage(t, {
    runs: [
      run({ id: 'w', waiting: true, reason: 'answer' }),
      run({ id: 'v', status: 'verification-unavailable', reason: 'no compiler' }),
      run({ id: 'i', status: 'interrupted', reason: 'signal' }),
    ],
  });
  if (!page) return;
  try {
    assert.deepEqual(
      await page.execute("return [...document.querySelectorAll('.card .reason')].map(x => x.textContent).sort()"),
      ['Agent interrupted: signal', 'Needs you: answer', 'Verification unavailable: no compiler'],
    );
    assert.equal(await page.execute("return document.querySelectorAll('.card.waiting').length"), 1);
    await page.execute("document.querySelector('[data-id=i]').click()");
    assert.equal(
      await page.execute("return document.querySelector('#detail .reason').textContent"),
      'Agent interrupted: signal',
    );
  } finally {
    await page.close();
  }
});

test('a local Spec and Ticket show their title as link text, cut off on the tile, and HTML in a title stays text', async (t) => {
  const long = 'A very long title '.repeat(30).trim();
  const page = await openPage(t, {
    runs: [
      run({
        id: 'r1',
        title: 'Titled docs',
        column: 'build',
        ticketsTotal: 3,
        ticketsDone: 0,
        tickets: ['.scratch/f/issues/01-a.md', '.scratch/f/issues/02-b.md', 'https://github.com/o/r/issues/7'],
        links: [
          { label: 'Spec', href: 'docs/specs/x.md' },
          { label: 'Ticket', href: '.scratch/f/issues/01-a.md' },
          { label: 'Ticket', href: '.scratch/f/issues/02-b.md' },
          { label: 'Ticket', href: 'https://github.com/o/r/issues/7' },
        ],
        titles: {
          'docs/specs/x.md': 'The Spec title',
          '.scratch/f/issues/01-a.md': '01 <img src=x onerror=alert(1)>',
          '.scratch/f/issues/02-b.md': `02 ${long}`,
        },
      }),
    ],
    documents: { 'docs/specs/x.md': '# The Spec\n', '.scratch/f/issues/01-a.md': '# Ticket A\n' },
  });
  if (!page) return;
  try {
    assert.deepEqual(
      await page.execute(
        "return [...document.querySelectorAll('.card .tickets .ticket-head')].map(h => { const el = h.querySelector('button.doc-link, a'); return [el.textContent, el.title]; })",
      ),
      [
        ['01 <img src=x onerror=alert(1)>', '.scratch/f/issues/01-a.md'],
        [`02 ${long}`, '.scratch/f/issues/02-b.md'],
        ['#7', ''],
      ],
    );
    assert.equal(await page.execute("return document.querySelector('.card .tickets img') === null"), true);
    // The long title is cut off by CSS: one line, with an ellipsis.
    assert.deepEqual(
      await page.execute(
        "const el = document.querySelectorAll('.card .tickets button.doc-link')[1]; const cs = getComputedStyle(el); return [cs.textOverflow, cs.whiteSpace, el.scrollWidth > el.clientWidth]",
      ),
      ['ellipsis', 'nowrap', true],
    );
    await page.execute("document.querySelector('[data-id=r1]').click()");
    await page.waitFor("return document.getElementById('detail').open");
    assert.deepEqual(
      await page.execute("return [...document.querySelectorAll('#detail .link')].map(d => d.textContent).slice(0, 2)"),
      ['Spec: The Spec title', 'Ticket: 01 <img src=x onerror=alert(1)>'],
    );
    // The opened document's heading stays the file name.
    await page.execute("document.querySelector('#detail .link button.doc-link').click()");
    await page.waitFor("return document.querySelector('#detail h3')?.textContent === 'The Spec'");
    assert.equal(await page.execute("return document.querySelector('#detail h2').textContent"), 'x.md');
  } finally {
    await page.close();
  }
});

test('a local Spec and Ticket open in the Run detail with a Back button, and an http Ticket stays an anchor', async (t) => {
  const page = await openPage(t, {
    runs: [
      run({
        id: 'r1',
        title: 'Local docs',
        column: 'build',
        ticketsTotal: 3,
        ticketsDone: 0,
        tickets: ['.scratch/f/issues/01-a.md', '.scratch/f/issues/02-gone.md', 'https://github.com/o/r/issues/7'],
        links: [
          { label: 'Spec', href: 'docs/specs/x.md' },
          { label: 'Ticket', href: '.scratch/f/issues/01-a.md' },
          { label: 'Ticket', href: '.scratch/f/issues/02-gone.md' },
          { label: 'Ticket', href: 'https://github.com/o/r/issues/7' },
        ],
      }),
    ],
    documents: { 'docs/specs/x.md': '# The Spec\n\n- item', '.scratch/f/issues/01-a.md': '# Ticket A\n\nBody' },
  });
  if (!page) return;
  try {
    // The tile: file name as text, path as tooltip; the http Ticket keeps its label and its tab.
    assert.deepEqual(
      await page.execute(
        "return [...document.querySelectorAll('.card .tickets .ticket-head')].map(h => { const el = h.querySelector('button.doc-link, a'); return [el.tagName, el.textContent, el.title, el.getAttribute('target')]; })",
      ),
      [
        ['BUTTON', '01-a.md', '.scratch/f/issues/01-a.md', null],
        ['BUTTON', '02-gone.md', '.scratch/f/issues/02-gone.md', null],
        ['A', '#7', '', '_blank'],
      ],
    );
    await page.execute("document.querySelector('.card .tickets button.doc-link').click()");
    await page.waitFor("return document.getElementById('detail').open && document.querySelector('#detail h3')");
    assert.equal(await page.execute("return document.querySelector('#detail h3').textContent"), 'Ticket A');
    assert.equal(await page.execute('return document.activeElement.tagName'), 'H2');
    // The headings of the document view nest without a gap: the file name is h2, the document's `#` is h3.
    assert.deepEqual(
      await page.execute(
        "return [...document.querySelectorAll('#detail h2, #detail h3, #detail h4, #detail h5, #detail h6')].map(h => Number(h.tagName[1]))",
      ),
      [2, 3],
    );
    await page.execute("document.querySelector('#detail .doc-back').click()");
    await page.waitFor(
      "return document.activeElement && document.activeElement.dataset.doc === '.scratch/f/issues/01-a.md'",
    );
    // The Spec link in the detail opens the Spec and Back returns to the Run view.
    await page.execute(
      "[...document.querySelectorAll('#detail .link button.doc-link')].find(b => b.dataset.doc === 'docs/specs/x.md').click()",
    );
    await page.waitFor("return document.querySelector('#detail h3')?.textContent === 'The Spec'");
    await page.execute("document.querySelector('#detail .doc-back').click()");
    await page.waitFor("return document.activeElement?.dataset.doc === 'docs/specs/x.md'");
    assert.match(await page.execute("return document.querySelector('#detail').textContent"), /Spec: x\.md/);
    // A document that is gone says so, with its path.
    await page.execute(
      "[...document.querySelectorAll('#detail .link button.doc-link')].find(b => b.dataset.doc.endsWith('02-gone.md')).click()",
    );
    await page.waitFor("return /no longer on disk/.test(document.getElementById('detail').textContent)");
    assert.equal(
      await page.execute("return document.querySelector('#detail [role=status]').textContent"),
      'This Ticket is no longer on disk: .scratch/f/issues/02-gone.md',
    );
  } finally {
    await page.close();
  }
});
