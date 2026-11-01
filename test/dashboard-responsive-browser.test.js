import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

const clickStage = `const button = [...document.querySelectorAll('nav[aria-label="Stages"] button')].find((b) => b.textContent.includes(arguments[0])); if (button) button.click(); return !!button`;
const visibleStages = `return [...document.querySelectorAll('#board section')].filter((s) => s.getBoundingClientRect().height > 0).map((s) => s.dataset.stage)`;

test('compact users can select a Stage and find waiting Runs after polling', async (t) => {
  const state = { runs: [run({ id: 'a', column: 'define', title: 'Define run' }), run({ id: 'b', column: 'build', title: 'Waiting run', waiting: true })] };
  const page = await openPage(t, state, { width: 375, height: 800 });
  if (!page) return;
  try {
    await page.waitFor("return document.querySelectorAll('.card').length === 2");
    assert.deepEqual(await page.execute(visibleStages), ['build']);
    assert.equal(await page.execute("return [...document.querySelectorAll('nav[aria-label=\"Stages\"] button')].length"), 6);
    assert.match(await page.execute("return document.querySelector('nav[aria-label=\"Stages\"]').textContent"), /Needs you/);
    assert.equal(await page.execute(clickStage, ['Finish']), true);
    assert.deepEqual(await page.execute(visibleStages), ['finish']);
    assert.match(await page.execute("return document.querySelector('[data-stage=finish]').textContent"), /No runs/);
    state.runs = [run({ id: 'c', column: 'check', title: 'New waiting run', waiting: true })];
    await page.waitFor("return !!document.querySelector('.card[data-id=c]')");
    assert.deepEqual(await page.execute(visibleStages), ['finish']);
  } finally { await page.close(); }
});

for (const width of [320, 375, 390, 768, 1024]) {
  test(`compact Stage navigation and controls fit at ${width}px`, async (t) => {
    const page = await openPage(t, { project: '/work/' + 'long-project-name-'.repeat(12), version: '1.2.3', runs: [run({ id: 'r', title: 'A'.repeat(240) })] }, { width, height: 800 });
    if (!page) return;
    try {
      await page.waitFor("return document.getElementById('factory-version')?.textContent === 'v1.2.3' && !!document.querySelector('.card')");
      assert.deepEqual(await page.execute(visibleStages), ['build']);
      assert.equal(await page.execute('return document.documentElement.scrollWidth <= window.innerWidth'), true);
      assert.equal(await page.execute("return document.querySelector('#factory-version').textContent"), 'v1.2.3');
      assert.equal(await page.execute("return document.getElementById('project').title"), '/work/' + 'long-project-name-'.repeat(12));
      const sizes = await page.execute("return [...document.querySelectorAll('nav[aria-label=\"Stages\"] button, #theme, #help, #board .column[data-active=true] .actions button')].map((e) => Math.round(e.getBoundingClientRect().height))");
      assert.ok(sizes.length >= 8 && sizes.every((h) => h >= 44), `touch heights: ${sizes}`);
      assert.equal(await page.execute(clickStage, ['Done']), true);
      assert.deepEqual(await page.execute(visibleStages), ['done']);
    } finally { await page.close(); }
  });
}

test('an empty dashboard shows the welcome card and a nonempty one chooses a useful initial Stage', async (t) => {
  for (const [runs, stage] of [[[], null], [[run({ column: 'check' })], 'check']]) {
    const page = await openPage(t, { runs }, { width: 390 });
    if (!page) return;
    try {
      await page.waitFor("return /^Updated/.test(document.getElementById('status').textContent)");
      if (stage) assert.deepEqual(await page.execute(visibleStages), [stage]);
      else {
        assert.deepEqual(await page.execute(visibleStages), [], 'no Stage columns');
        assert.equal(await page.execute("return !!document.querySelector('.welcome') && document.documentElement.scrollWidth <= window.innerWidth && document.querySelector('.welcome .link').getBoundingClientRect().height >= 44"), true);
      }
    } finally { await page.close(); }
  }
});

test('Stage choice survives older-Run filtering and crossing the desktop breakpoint', async (t) => {
  const old = new Date(Date.now() - 9 * 86400000).toISOString();
  const page = await openPage(t, { runs: [run({ id: 'a', column: 'build' }), run({ id: 'old', column: 'finish', updated: old })] }, { width: 768, height: 800 });
  if (!page) return;
  try {
    await page.waitFor("return document.getElementById('older').textContent.includes('Show older')");
    assert.equal(await page.execute(clickStage, ['Finish']), true);
    assert.match(await page.execute("return document.querySelector('[data-stage=finish]').textContent"), /No runs/);
    await page.execute("document.getElementById('older').click()");
    await page.waitFor("return !!document.querySelector('.card[data-id=old]')");
    assert.deepEqual(await page.execute(visibleStages), ['finish']);
    await page.resize(1200, 800);
    assert.deepEqual(await page.execute(visibleStages), ['define', 'build', 'check', 'finish', 'follow-up', 'done']);
    await page.resize(768, 800);
    assert.deepEqual(await page.execute(visibleStages), ['finish']);
  } finally { await page.close(); }
});

test('compact header keeps theme, version and connection errors visible', async (t) => {
  const page = await openPage(t, { version: '9.1.2', project: '/work/project', runs: [run()] }, { width: 320 });
  if (!page) return;
  try {
    await page.waitFor("return document.getElementById('factory-version')?.textContent === 'v9.1.2'");
    await page.execute("const theme = document.getElementById('theme'); theme.value = 'dark'; theme.dispatchEvent(new Event('change', { bubbles: true }))");
    assert.equal(await page.execute("return document.documentElement.dataset.theme"), 'dark');
    page.state.failViews = true;
    await page.waitFor("return document.getElementById('status').classList.contains('error')");
    assert.match(await page.execute("return document.getElementById('status').textContent"), /Cannot reach the server/);
    assert.equal(await page.execute('return document.documentElement.scrollWidth <= window.innerWidth'), true);
    assert.equal(await page.execute("return document.getElementById('factory-version').textContent"), 'v9.1.2');
  } finally { await page.close(); }
});

test('Stage buttons count the visible Runs and mark the Stage that needs the user', async (t) => {
  const old = new Date(Date.now() - 9 * 86400000).toISOString();
  const runs = [run({ id: 'a', column: 'define' }), run({ id: 'b', column: 'build' }), run({ id: 'c', column: 'build', waiting: true }), run({ id: 'old', column: 'build', updated: old }), run({ id: 'done', column: 'done', status: 'done' })];
  const page = await openPage(t, { runs }, { width: 390, height: 800 });
  if (!page) return;
  try {
    const buttons = "return [...document.querySelectorAll('nav[aria-label=\"Stages\"] button')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim())";
    await page.waitFor("return document.querySelectorAll('.card').length > 0");
    assert.deepEqual(await page.execute(buttons), ['Define (1)', 'Build (2) Needs you', 'Check (0)', 'Finish (0)', 'Follow-up (0)', 'Done (1)']);
    await page.execute("document.getElementById('older').click()");
    await page.waitFor("return document.getElementById('older').textContent === 'Hide older runs'");
    assert.deepEqual(await page.execute(buttons), ['Define (1)', 'Build (3) Needs you', 'Check (0)', 'Finish (0)', 'Follow-up (0)', 'Done (1)']);
  } finally { await page.close(); }
});

test('Show older and Delete all are touch sized on compact screens', async (t) => {
  const old = new Date(Date.now() - 9 * 86400000).toISOString();
  const page = await openPage(t, { runs: [run({ id: 'a', column: 'done', status: 'done' }), run({ id: 'old', column: 'build', updated: old })] }, { width: 320, height: 800 });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('.card')");
    assert.equal(await page.execute(clickStage, ['Done']), true);
    const sizes = await page.execute("return ['#older', '.column[data-stage=done] > button'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().height))");
    assert.ok(sizes.every((h) => h >= 44), `touch heights: ${sizes}`);
  } finally { await page.close(); }
});
