import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

const TAB = '\uE004';
const ESCAPE = '\uE00C';
const SHIFT = '\uE008';
const PAGE_DOWN = '\uE00F';
const SHORT_HEIGHT = 280;

test('compact Run detail contains keyboard focus and returns to the same Stage and card', async (t) => {
  const page = await openPage(
    t,
    {
      runs: [
        run({
          id: 'r',
          column: 'build',
          title: 'Run to inspect',
          links: [{ label: 'PR', href: 'https://example.test/pull/1' }],
        }),
      ],
    },
    { width: 375, height: 700 },
  );
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=r]')");
    await page.execute("document.querySelector('[data-id=r]').focus(); document.querySelector('[data-id=r]').click()");
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')");
    assert.equal(
      await page.execute(
        "return !![...document.querySelectorAll('#detail button')].find(b => /Back to stages/i.test(b.textContent))",
      ),
      true,
    );
    // The board is unavailable behind the modal dialog: it cannot take focus.
    assert.equal(
      await page.execute(
        "document.getElementById('theme').focus(); return document.activeElement.closest('#detail') !== null",
      ),
      true,
    );
    await page.execute("document.querySelector('#detail .compact-back button').focus()");
    // Tab may leave the page for the browser's own controls, but never lands on the board or the header.
    await page.keyChord(SHIFT, TAB);
    const behind = "return document.activeElement.closest('#app > header, #board, .stage-nav') === null";
    assert.equal(await page.execute(behind), true);
    for (let i = 0; i < 6; i++) {
      await page.key(TAB);
      assert.equal(await page.execute(behind), true);
    }
    await page.execute("document.querySelector('#detail h2').focus()");
    await page.execute(
      "[...document.querySelectorAll('#detail button')].find(b => /Back to stages/i.test(b.textContent)).click()",
    );
    await page.waitFor(
      "return document.getElementById('detail').hidden && document.activeElement === document.querySelector('[data-id=r]')",
    );
    assert.equal(
      await page.execute(
        "return document.querySelector('nav[aria-label=\"Stages\"] button[aria-pressed=true]').textContent.includes('Build')",
      ),
      true,
    );
  } finally {
    await page.close();
  }
});

const longText = 'unbrokenword'.repeat(90);
const markdown = `# Findings\n\n${longText}\n\n| Header | Another header |\n| --- | --- |\n| ${longText} | ${longText} |`;
for (const width of [320, 375, 390, 768, 1024]) {
  test(`Run detail fits the viewport and contains wide content at ${width}px`, async (t) => {
    const page = await openPage(
      t,
      {
        runs: [
          run({
            id: 'r',
            title: 'A'.repeat(180),
            files: ['define.md'],
            links: [{ label: 'PR', href: 'https://example.test/' + 'a'.repeat(250) }],
          }),
        ],
        files: { 'r/define.md': markdown },
      },
      { width, height: 700 },
    );
    if (!page) return;
    try {
      await page.waitFor("return !!document.querySelector('[data-id=r]')");
      await page.execute("document.querySelector('[data-id=r]').click()");
      await page.waitFor("return !!document.querySelector('#detail .md table')");
      const result = await page.execute(
        "const d=document.getElementById('detail'), r=d.getBoundingClientRect(), b=document.querySelector('#detail .compact-back button').getBoundingClientRect(), t=document.querySelector('#detail .md .scroll'); return {left:r.left, top:r.top, width:r.width, height:r.height, panel:d.scrollWidth, client:d.clientWidth, viewport:document.documentElement.clientWidth, page:document.documentElement.scrollWidth, backHeight:b.height, table:t.scrollWidth, tableClient:t.clientWidth}",
      );
      assert.ok(
        result.left === 0 && result.top === 0 && result.width === result.viewport && result.height === 700,
        JSON.stringify(result),
      );
      assert.ok(result.page <= result.viewport && result.panel <= result.client, JSON.stringify(result));
      assert.ok(result.backHeight >= 44 && result.table > result.tableClient, JSON.stringify(result));
    } finally {
      await page.close();
    }
  });
}

test('desktop drawer stays inside the viewport, makes the board unavailable and closes on a backdrop click', async (t) => {
  const page = await openPage(
    t,
    {
      runs: [run({ id: 'a', title: 'First', files: ['define.md'] }), run({ id: 'b', title: 'Second' })],
      files: { 'a/define.md': markdown },
    },
    { width: 1200, height: 700 },
  );
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=a]')");
    const board = await page.execute("return document.getElementById('board').getBoundingClientRect().width");
    await page.execute("document.querySelector('[data-id=a]').focus(); document.querySelector('[data-id=a]').click()");
    await page.waitFor("return !!document.querySelector('#detail .md table')");
    const result = await page.execute(
      "const d=document.getElementById('detail'), r=d.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,right:r.right,vw:document.documentElement.clientWidth,panel:d.scrollWidth,client:d.clientWidth,viewport:innerHeight,width:innerWidth,board:document.getElementById('board').getBoundingClientRect().width,modal:d.matches(':modal')}",
    );
    assert.ok(
      result.top >= 0 && result.bottom <= result.viewport && result.panel <= result.client,
      JSON.stringify(result),
    );
    assert.ok(result.modal && result.right === result.vw && result.board === board, JSON.stringify(result));
    // A click on the backdrop, left of the drawer, closes it and gives the focus back to the card.
    await page.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 20, y: 300, button: 'left', clickCount: 1 });
    await page.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 20, y: 300, button: 'left', clickCount: 1 });
    await page.waitFor(
      "return document.getElementById('detail').hidden && document.activeElement === document.querySelector('[data-id=a]')",
    );
  } finally {
    await page.close();
  }
});

test('detail keeps its Back control on a short screen and the Run stays in view after closing', async (t) => {
  const runs = Array.from({ length: 12 }, (_, i) => run({ id: 'r' + i, title: 'Run ' + i, files: ['define.md'] }));
  runs[4].title = 'A very long title '.repeat(30);
  const page = await openPage(
    t,
    {
      runs,
      files: { 'r4/define.md': '# Findings\n\n' + Array.from({ length: 80 }, (_, i) => `- item ${i}`).join('\n') },
    },
    { width: 320, height: SHORT_HEIGHT },
  );
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=r4]')");
    await page.execute(
      "const card=document.querySelector('[data-id=r4]'); card.scrollIntoView({block:'center'}); card.focus()",
    );
    await page.execute("document.querySelector('[data-id=r4]').click()");
    await page.waitFor("return document.querySelector('#detail h2') === document.activeElement");
    for (let i = 0; i < 4; i++) await page.key(PAGE_DOWN); // Page Down scrolls the open detail.
    await page.waitFor("return document.getElementById('detail').scrollTop > 0");
    const result = await page.execute(
      "const d=document.getElementById('detail'), b=document.querySelector('#detail .compact-back button').getBoundingClientRect(); return {detail:d.scrollTop,top:b.top,bottom:b.bottom}",
    );
    assert.ok(result.detail > 0 && result.top >= 0 && result.bottom <= SHORT_HEIGHT, JSON.stringify(result));
    await page.key(ESCAPE);
    await page.waitFor(
      "return document.getElementById('detail').hidden && document.activeElement === document.querySelector('[data-id=r4]')",
    );
    // The card is on screen again; no measured scroll offset is compared, as it depends on layout timing.
    assert.equal(
      await page.execute(
        "const r=document.querySelector('[data-id=r4]').getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight",
      ),
      true,
    );
  } finally {
    await page.close();
  }
});

test('the open detail turns from drawer to full-screen sheet and back when crossing the breakpoint', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'r', title: 'Resize me' })] }, { width: 375, height: 700 });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=r]')");
    await page.execute("document.querySelector('[data-id=r]').click()");
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')");
    const width = () => page.execute("return document.getElementById('detail').getBoundingClientRect().width");
    const viewport = () => page.execute('return document.documentElement.clientWidth');
    assert.equal(await width(), await viewport());
    await page.resize(1200, 700);
    assert.equal(await page.execute("return document.getElementById('detail').open"), true); // the same dialog stays open
    assert.equal(await width(), 640);
    assert.equal(await page.execute("document.getElementById('theme').focus(); return document.activeElement.id"), '');
    await page.resize(375, 700);
    assert.equal(await width(), await viewport());
    assert.equal(await page.execute("return document.activeElement.closest('#detail') !== null"), true);
    await page.key(ESCAPE);
    await page.waitFor(
      "return document.getElementById('detail').hidden && document.activeElement === document.querySelector('[data-id=r]')",
    );
  } finally {
    await page.close();
  }
});

test('short confirmation dialogs keep cancel and discard actions reachable', async (t) => {
  const page = await openPage(
    t,
    {
      runs: [run({ id: 'r', title: 'A long run title '.repeat(12) })],
      respond: () => ({ status: 409, body: 'dirty', headers: { 'x-factory-error': 'dirty-worktree' } }),
    },
    { width: 320, height: SHORT_HEIGHT },
  );
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=r] .danger')");
    await page.execute("const b=document.querySelector('[data-id=r] .danger'); b.scrollIntoView(); b.click()");
    await page.waitFor("return document.querySelector('#dialog').open");
    /** @type {number[]} */
    const touch = await page.execute(
      "return [...document.querySelectorAll('#dialog button')].map(b => b.getBoundingClientRect().height)",
    );
    assert.ok(
      touch.every((h) => h >= 44),
      JSON.stringify(touch),
    );
    await page.execute("const b=document.getElementById('dialog-confirm'); b.scrollIntoView(); b.click()");
    await page.waitFor(
      "return document.getElementById('dialog-title').textContent === 'Discard uncommitted changes?' && document.querySelector('#dialog').open && document.activeElement === document.getElementById('dialog-cancel')",
    );
    const reach = await page.execute(
      "const b=document.getElementById('dialog-cancel'); b.scrollIntoView(); const r=b.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,width:document.documentElement.scrollWidth, dialog:document.querySelector('#dialog').getBoundingClientRect().height}",
    );
    assert.ok(
      reach.top >= 0 && reach.bottom <= SHORT_HEIGHT && reach.width <= 320 && reach.dialog <= SHORT_HEIGHT,
      JSON.stringify(reach),
    );
    await page.key(ESCAPE);
    await page.waitFor("return !document.querySelector('#dialog').open");
    assert.deepEqual(page.calls, ['DELETE /api/runs/r']);
  } finally {
    await page.close();
  }
});

test('Escape closes only the confirmation above the detail, then the detail', async (t) => {
  const page = await openPage(
    t,
    {
      runs: [
        run({
          id: 'w',
          title: 'At the limit',
          column: 'check',
          status: 'waiting',
          waiting: true,
          loops: 4,
          loopCap: 4,
        }),
      ],
    },
    { width: 1200, height: 700 },
  );
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=w]')");
    await page.execute("document.querySelector('[data-id=w]').click()");
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')");
    // A real click gives the page user activation, so the browser treats the two dialogs as separate close requests.
    const at = await page.execute(
      'const r = document.querySelector(\'#detail [aria-label^="Grant an extra Check loop"]\').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]',
    );
    for (const type of ['mousePressed', 'mouseReleased'])
      await page.cdp('Input.dispatchMouseEvent', { type, x: at[0], y: at[1], button: 'left', clickCount: 1 });
    await page.waitFor("return document.querySelector('#dialog').open");
    await page.key(ESCAPE);
    await page.waitFor("return !document.querySelector('#dialog').open");
    assert.equal(await page.execute("return document.getElementById('detail').open"), true);
    await page.wait(300);
    assert.equal(await page.execute("return document.getElementById('detail').open"), true);
    await page.key(ESCAPE);
    await page.waitFor(
      "return document.getElementById('detail').hidden && document.activeElement === document.querySelector('[data-id=w]')",
    );
    assert.deepEqual(page.calls, []);
  } finally {
    await page.close();
  }
});

test('resizing desktop detail returns to the Stage of the selected Run', async (t) => {
  const page = await openPage(
    t,
    {
      runs: [
        run({ id: 'a', column: 'build', title: 'Build run' }),
        run({ id: 'b', column: 'check', title: 'Check run' }),
      ],
    },
    { width: 1200, height: 700 },
  );
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=b]')");
    await page.execute("document.querySelector('[data-id=b]').click()");
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')");
    await page.resize(375, 700);
    await page.key(ESCAPE);
    await page.waitFor("return document.getElementById('detail').hidden");
    assert.equal(await page.execute("return document.activeElement === document.querySelector('[data-id=b]')"), true);
    assert.equal(
      await page.execute("return document.querySelector('[data-stage=check]').getBoundingClientRect().height > 0"),
      true,
    );
  } finally {
    await page.close();
  }
});

test('Back lands on the Stage the Run is in now when it moved while its detail was open', async (t) => {
  const state = { runs: [run({ id: 'r', column: 'build', title: 'Moving run' })] };
  const page = await openPage(t, state, { width: 375, height: 700 });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=r]')");
    await page.execute("document.querySelector('[data-id=r]').click()");
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')");
    state.runs = [run({ id: 'r', column: 'check', title: 'Moving run' })];
    await page.waitFor("return document.querySelector('[data-id=r]').closest('[data-stage=check]') !== null");
    await page.key(ESCAPE);
    await page.waitFor(
      "return document.getElementById('detail').hidden && document.activeElement === document.querySelector('[data-id=r]')",
    );
    assert.equal(
      await page.execute("return document.querySelector('[data-stage=check]').getBoundingClientRect().height > 0"),
      true,
    );
  } finally {
    await page.close();
  }
});

test('Shift+Tab from the detail heading goes to the Back control', async (t) => {
  const page = await openPage(
    t,
    { runs: [run({ id: 'r', links: [{ label: 'PR', href: 'https://example.test/pull/1' }] })] },
    { width: 375, height: 700 },
  );
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=r]')");
    await page.execute("document.querySelector('[data-id=r]').click()");
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')");
    await page.keyChord(SHIFT, TAB);
    assert.equal(
      await page.execute("return document.activeElement === document.querySelector('#detail .compact-back button')"),
      true,
    );
  } finally {
    await page.close();
  }
});

test('a wide table in compact detail can be reached with the keyboard', async (t) => {
  const wide = 'wide'.repeat(120);
  const page = await openPage(
    t,
    {
      runs: [run({ id: 'r', files: ['define.md'], links: [{ label: 'PR', href: 'https://example.test/pull/1' }] })],
      files: { 'r/define.md': `| A | B |\n| --- | --- |\n| ${wide} | ${wide} |` },
    },
    { width: 375, height: 700 },
  );
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=r]')");
    await page.execute("document.querySelector('[data-id=r]').click()");
    await page.waitFor("return !!document.querySelector('#detail .md .scroll')");
    await page.execute("document.querySelector('#detail .link a').focus()");
    await page.key(TAB);
    assert.equal(
      await page.execute("return document.activeElement === document.querySelector('#detail .md .scroll')"),
      true,
    );
  } finally {
    await page.close();
  }
});

test('closing desktop detail keeps the Stage of the Run that moved while it was open', async (t) => {
  const state = { runs: [run({ id: 'r', column: 'build' }), run({ id: 'x', column: 'define' })] };
  const page = await openPage(t, state, { width: 1200, height: 700 });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=r]')");
    await page.execute("document.querySelector('[data-id=r]').click()");
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')");
    state.runs = [run({ id: 'r', column: 'check' }), run({ id: 'x', column: 'define' })];
    await page.waitFor("return document.querySelector('[data-id=r]').closest('[data-stage=check]') !== null");
    await page.key(ESCAPE);
    await page.waitFor("return document.getElementById('detail').hidden");
    await page.resize(375, 700);
    await page.waitFor("return document.querySelector('[data-stage=check]').getBoundingClientRect().height > 0");
  } finally {
    await page.close();
  }
});
