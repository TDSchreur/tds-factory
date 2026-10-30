import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

const TAB = '\uE004';
const ESCAPE = '\uE00C';

test('compact Run detail contains keyboard focus and returns to the same Stage and card', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'r', column: 'build', title: 'Run to inspect', links: [{ label: 'PR', href: 'https://example.test/pull/1' }] })] }, { width: 375, height: 700 });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=r]')");
    await page.execute("document.querySelector('[data-id=r]').focus(); document.querySelector('[data-id=r]').click()");
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')");
    assert.equal(await page.execute("return !![...document.querySelectorAll('#detail button')].find(b => /Back to stages/i.test(b.textContent))"), true);
    assert.equal(await page.execute("document.getElementById('theme').focus(); return document.activeElement.closest('#detail') !== null"), true);
    await page.execute("document.querySelector('#detail .compact-back button').focus()");
    await page.keyChord('\uE008', TAB); // Shift+Tab wraps to the last detail control.
    assert.equal(await page.execute("return document.activeElement === document.querySelector('#detail .link a')"), true);
    await page.key(TAB);
    assert.equal(await page.execute("return document.activeElement === document.querySelector('#detail .compact-back button')"), true);
    for (let i = 0; i < 5; i++) {
      await page.key(TAB);
      assert.equal(await page.execute("return document.activeElement.closest('#detail') !== null"), true);
    }
    await page.execute("[...document.querySelectorAll('#detail button')].find(b => /Back to stages/i.test(b.textContent)).click()");
    await page.waitFor("return document.getElementById('detail').hidden && document.activeElement === document.querySelector('[data-id=r]')");
    assert.equal(await page.execute("return document.querySelector('nav[aria-label=\"Stages\"] button[aria-pressed=true]').textContent.includes('Build')"), true);
  } finally { await page.close(); }
});

const longText = 'unbrokenword'.repeat(90);
const markdown = `# Findings\n\n${longText}\n\n| Header | Another header |\n| --- | --- |\n| ${longText} | ${longText} |`;
for (const width of [320, 375, 390, 768, 1024]) {
  test(`Run detail fits the viewport and contains wide content at ${width}px`, async (t) => {
    const page = await openPage(t, { runs: [run({ id: 'r', title: 'A'.repeat(180), files: ['define.md'], links: [{ label: 'PR', href: 'https://example.test/' + 'a'.repeat(250) }] })], files: { 'r/define.md': markdown } }, { width, height: 700 });
    if (!page) return;
    try {
      await page.waitFor("return !!document.querySelector('[data-id=r]')");
      await page.execute("document.querySelector('[data-id=r]').click()");
      await page.waitFor("return !!document.querySelector('#detail .md table')");
      const result = await page.execute("const d=document.getElementById('detail'), r=d.getBoundingClientRect(), b=document.querySelector('#detail .compact-back button').getBoundingClientRect(), t=document.querySelector('#detail .md .scroll'); return {left:r.left, top:r.top, width:r.width, height:r.height, panel:d.scrollWidth, client:d.clientWidth, page:document.documentElement.scrollWidth, backHeight:b.height, table:t.scrollWidth, tableClient:t.clientWidth}");
      assert.ok(result.left === 0 && result.top === 0 && result.width === width && result.height === 700, JSON.stringify(result));
      assert.ok(result.page <= width && result.panel <= result.client, JSON.stringify(result));
      assert.ok(result.backHeight >= 44 && result.table > result.tableClient, JSON.stringify(result));
    } finally { await page.close(); }
  });
}

test('desktop detail stays inside the viewport and leaves the board interactive', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'a', title: 'First', files: ['define.md'] }), run({ id: 'b', title: 'Second' })], files: { 'a/define.md': markdown } }, { width: 1200, height: 700 });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=a]')");
    await page.execute("document.querySelector('[data-id=a]').click()");
    await page.waitFor("return !!document.querySelector('#detail .md table')");
    const result = await page.execute("const d=document.getElementById('detail'), r=d.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,panel:d.scrollWidth,client:d.clientWidth,viewport:innerHeight}");
    assert.ok(result.top >= 0 && result.bottom <= result.viewport && result.panel <= result.client, JSON.stringify(result));
    await page.execute("document.querySelector('[data-id=b]').click()");
    await page.waitFor("return document.querySelector('#detail h2').textContent === 'Second'");
  } finally { await page.close(); }
});

test('detail keeps its Back control and background position on a short screen', async (t) => {
  const runs = Array.from({ length: 12 }, (_, i) => run({ id: 'r' + i, title: 'Run ' + i, files: ['define.md'] }));
  runs[4].title = 'A very long title '.repeat(30);
  const page = await openPage(t, { runs, files: { 'r4/define.md': '# Findings\n\n' + Array.from({ length: 80 }, (_, i) => `- item ${i}`).join('\n') } }, { width: 320, height: 280 });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=r4]')");
    const before = await page.execute("const card=document.querySelector('[data-id=r4]'); card.scrollIntoView({block:'center'}); card.focus(); return window.scrollY");
    await page.execute("document.querySelector('[data-id=r4]').click()");
    await page.waitFor("return document.querySelector('#detail h2') === document.activeElement");
    for (let i = 0; i < 4; i++) await page.key('\uE00F'); // Page Down is handled by the open detail.
    await page.waitFor("return document.getElementById('detail').scrollTop > 0");
    const result = await page.execute("const d=document.getElementById('detail'), b=document.querySelector('#detail .compact-back button').getBoundingClientRect(); return {page:window.scrollY,detail:d.scrollTop,top:b.top,bottom:b.bottom}");
    assert.equal(result.page, before);
    assert.ok(result.detail > 0 && result.top >= 0 && result.bottom <= innerHeightForTest, JSON.stringify(result));
    await page.key(ESCAPE);
    await page.waitFor("return document.getElementById('detail').hidden && document.activeElement === document.querySelector('[data-id=r4]')");
    assert.equal(await page.execute('return window.scrollY'), before);
  } finally { await page.close(); }
});

const innerHeightForTest = 280;

test('open detail changes focus and background behavior when crossing the breakpoint', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'r', title: 'Resize me' })] }, { width: 375, height: 700 });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=r]')");
    await page.execute("document.querySelector('[data-id=r]').click()");
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')");
    await page.resize(1200, 700);
    await page.waitFor("return document.querySelector('#detail').getAttribute('aria-modal') !== 'true'");
    assert.equal(await page.execute("document.getElementById('theme').focus(); return document.activeElement.id"), 'theme');
    await page.resize(375, 700);
    await page.waitFor("return document.querySelector('#detail').getAttribute('aria-modal') === 'true'");
    assert.equal(await page.execute("return document.activeElement.closest('#detail') !== null"), true);
    await page.key(ESCAPE);
    await page.waitFor("return document.getElementById('detail').hidden && document.activeElement === document.querySelector('[data-id=r]')");
  } finally { await page.close(); }
});

test('short confirmation dialogs keep cancel and discard actions reachable', async (t) => {
  const page = await openPage(t, {
    runs: [run({ id: 'r', title: 'A long run title '.repeat(12) })],
    respond: () => ({ status: 409, body: 'dirty', headers: { 'x-factory-error': 'dirty-worktree' } }),
  }, { width: 320, height: 280 });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=r] .danger')");
    await page.execute("const b=document.querySelector('[data-id=r] .danger'); b.scrollIntoView(); b.click()");
    await page.waitFor("return document.querySelector('dialog').open");
    const touch = await page.execute("return [...document.querySelectorAll('dialog button')].map(b => b.getBoundingClientRect().height)");
    assert.ok(touch.every((h) => h >= 44), JSON.stringify(touch));
    await page.execute("const b=document.getElementById('dialog-confirm'); b.scrollIntoView(); b.click()");
    await page.waitFor("return document.getElementById('dialog-title').textContent === 'Discard uncommitted changes?'");
    const reach = await page.execute("const b=document.getElementById('dialog-cancel'); b.scrollIntoView(); const r=b.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,width:document.documentElement.scrollWidth, dialog:document.querySelector('dialog').getBoundingClientRect().height}");
    assert.ok(reach.top >= 0 && reach.bottom <= 280 && reach.width <= 320 && reach.dialog <= 280, JSON.stringify(reach));
    await page.key(ESCAPE);
    await page.waitFor("return !document.querySelector('dialog').open");
    assert.deepEqual(page.calls, ['DELETE /api/runs/r']);
  } finally { await page.close(); }
});

test('native confirmation retains keyboard control over compact detail', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'r', title: 'A run' })] }, { width: 1200, height: 700 });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=r]')");
    await page.execute("document.querySelector('[data-id=r]').click()");
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')");
    await page.execute("document.querySelector('[data-id=r] .danger').click()");
    await page.waitFor("return document.querySelector('dialog').open");
    await page.resize(375, 700);
    await page.waitFor("return document.querySelector('#detail').getAttribute('aria-modal') === 'true'");
    for (let i = 0; i < 3; i++) {
      await page.key(TAB);
      assert.equal(await page.execute("return document.activeElement.closest('#detail') === null"), true);
    }
    await page.key(ESCAPE);
    await page.waitFor("return !document.querySelector('dialog').open");
    assert.equal(await page.execute("return !document.getElementById('detail').hidden"), true);
    assert.equal(await page.execute("return document.activeElement.closest('#detail') !== null"), true);
    assert.deepEqual(page.calls, []);
  } finally { await page.close(); }
});

test('resizing desktop detail returns to the Stage of the selected Run', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'a', column: 'build', title: 'Build run' }), run({ id: 'b', column: 'check', title: 'Check run' })] }, { width: 1200, height: 700 });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=b]')");
    await page.execute("document.querySelector('[data-id=b]').click()");
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')");
    await page.resize(375, 700);
    await page.waitFor("return document.querySelector('#detail').getAttribute('aria-modal') === 'true'");
    await page.key(ESCAPE);
    await page.waitFor("return document.getElementById('detail').hidden");
    assert.equal(await page.execute("return document.activeElement === document.querySelector('[data-id=b]')"), true);
    assert.equal(await page.execute("return document.querySelector('[data-stage=check]').getBoundingClientRect().height > 0"), true);
  } finally { await page.close(); }
});
