import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

const runs = () => [run({ id: 'a', title: 'Active', column: 'build' })];
const open = "return document.getElementById('help-panel').open";

test('the Help button opens the help panel with the focus inside, and Esc closes it and returns the focus', async (t) => {
  const page = await openPage(t, { runs: runs() });
  if (!page) return;
  try {
    assert.equal(await page.execute("return document.getElementById('intro')"), null, 'the old intro is gone');
    assert.equal(await page.execute(open), false);
    await page.execute("document.getElementById('help').click()");
    await page.waitFor(open);
    assert.equal(await page.execute("return document.getElementById('help-panel').contains(document.activeElement)"), true);
    assert.deepEqual(await page.execute("return [...document.querySelectorAll('#help-panel h3')].map((h) => h.textContent)"), ['Stages', 'Tracks', 'Waiting on you', 'Check verdicts', 'Actions']);
    assert.match(await page.execute("return document.getElementById('help-panel').textContent"), /\/factory/);
    await page.key(''); // Escape
    await page.waitFor("return !document.getElementById('help-panel').open && document.activeElement.id === 'help'"); // the close event follows the closing
  } finally { await page.close(); }
});

test('Tab stays inside the help panel and the Close button closes it', async (t) => {
  const page = await openPage(t, { runs: runs() });
  if (!page) return;
  try {
    await page.execute("document.getElementById('help').click()");
    await page.waitFor(open);
    for (let i = 0; i < 4; i++) {
      await page.key(''); // Tab
      assert.equal(await page.execute("return document.getElementById('help-panel').contains(document.activeElement)"), true, 'Tab ' + i);
    }
    await page.keyChord('\uE008', '\uE004'); // Shift+Tab
    assert.equal(await page.execute("return document.getElementById('help-panel').contains(document.activeElement)"), true, 'Shift+Tab');
    await page.execute("document.getElementById('help-close').click()");
    await page.waitFor("return !document.getElementById('help-panel').open && document.activeElement.id === 'help'");
  } finally { await page.close(); }
});

test('on a phone the help panel fills the screen and its buttons are 44 px tall', async (t) => {
  const page = await openPage(t, { runs: runs() }, { width: 375, height: 700 });
  if (!page) return;
  try {
    await page.execute("document.getElementById('help').click()");
    await page.waitFor(open);
    const box = await page.execute("const r = document.getElementById('help-panel').getBoundingClientRect(); return { width: r.width, height: r.height, close: document.getElementById('help-close').getBoundingClientRect().height, help: document.getElementById('help').getBoundingClientRect().height, scroll: document.documentElement.scrollWidth <= window.innerWidth }");
    assert.equal(box.width, 375);
    assert.equal(box.height, 700);
    assert.ok(box.close >= 44, 'close ' + box.close);
    assert.ok(box.help >= 44, 'help ' + box.help);
    assert.equal(box.scroll, true);
  } finally { await page.close(); }
});

test('with no Runs a welcome card replaces the Stage columns, says how to start and opens the help panel', async (t) => {
  const page = await openPage(t, { runs: [] });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('.welcome')");
    assert.equal(await page.execute("return document.querySelectorAll('#board, .column').length"), 0, 'no empty columns');
    assert.match(await page.execute("return document.querySelector('.welcome').textContent"), /\/factory/);
    assert.equal(await page.execute("return document.querySelector('.welcome code').textContent.startsWith('/factory ')"), true);
    await page.execute("document.querySelector('.welcome button').focus(); document.querySelector('.welcome button').click()");
    await page.waitFor(open);
    await page.key('');
    await page.waitFor("return !document.getElementById('help-panel').open && document.activeElement === document.querySelector('.welcome button')"); // the focus returns to the link
  } finally { await page.close(); }
});

test('the welcome card is gone once a Run exists, and a filter that hides every Run does not bring it back', async (t) => {
  const state = { runs: [] };
  const page = await openPage(t, state);
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('.welcome')");
    state.runs.push(run({ id: 'a', title: 'First', column: 'build' }));
    await page.waitFor("return !document.querySelector('.welcome') && !!document.querySelector('[data-id=a]')");
    await page.execute("document.getElementById('needs-you').click()");
    await page.waitFor("return document.getElementById('needs-you').getAttribute('aria-pressed') === 'true'");
    assert.equal(await page.execute("return document.querySelector('.welcome')"), null);
    assert.ok(await page.execute("return document.querySelectorAll('.column').length") > 0, 'the columns show the empty filter');
  } finally { await page.close(); }
});
