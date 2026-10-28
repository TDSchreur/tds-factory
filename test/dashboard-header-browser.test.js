import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

const dot = "return getComputedStyle(document.getElementById('status'), '::before').backgroundColor";

test('the header shows the project as a pill with the full path as tooltip', async (t) => {
  const page = await openPage(t, { project: '/work/tds-factory', runs: [run()] });
  if (!page) return;
  try {
    assert.equal(await page.execute("return document.querySelector('header h1').textContent"), 'tds-factory');
    assert.equal(await page.execute("return document.getElementById('project').textContent"), 'tds-factory');
    assert.equal(await page.execute("return document.getElementById('project').title"), '/work/tds-factory');
    assert.equal(await page.execute("return getComputedStyle(document.getElementById('project')).textOverflow"), 'ellipsis');
  } finally { await page.close(); }
});

test('a Windows-style project path shows its last segment', async (t) => {
  const page = await openPage(t, { project: 'C:\\work\\my-project\\', runs: [run()] });
  if (!page) return;
  try {
    assert.equal(await page.execute("return document.getElementById('project').textContent"), 'my-project');
    assert.equal(await page.execute("return document.getElementById('project').title"), 'C:\\work\\my-project\\');
  } finally { await page.close(); }
});

test('the status dot is one colour while live and another when the server cannot be reached', async (t) => {
  const page = await openPage(t, { runs: [run()] });
  if (!page) return;
  try {
    await page.waitFor("return /^Updated/.test(document.getElementById('status').textContent)");
    const live = await page.execute(dot);
    assert.notEqual(live, 'rgba(0, 0, 0, 0)');
    page.state.failViews = true;
    await page.waitFor("return document.getElementById('status').className === 'error'");
    const down = await page.execute(dot);
    assert.notEqual(down, 'rgba(0, 0, 0, 0)');
    assert.notEqual(down, live);
  } finally { await page.close(); }
});

test('the controls sit on the right and the theme select has an accessible name without a visible label', async (t) => {
  const page = await openPage(t, { runs: [run()] });
  if (!page) return;
  try {
    assert.equal(await page.execute("return document.querySelectorAll('header label').length"), 0);
    assert.equal(await page.execute("return document.getElementById('theme').getAttribute('aria-label')"), 'Theme');
    assert.equal(await page.execute("return document.getElementById('theme').getBoundingClientRect().left > document.getElementById('project').getBoundingClientRect().right"), true);
    assert.equal(await page.execute("return getComputedStyle(document.querySelector('header')).position"), 'sticky');
  } finally { await page.close(); }
});

test('a long project name and a narrow screen do not make the page scroll sideways', async (t) => {
  const page = await openPage(t, { project: '/home/dennis/' + 'very-long-project-name-'.repeat(8), runs: [run()] }, { width: 400 });
  if (!page) return;
  try {
    assert.equal(await page.execute('return document.documentElement.scrollWidth <= window.innerWidth'), true);
    assert.equal(await page.execute("return document.getElementById('project').getBoundingClientRect().right <= window.innerWidth"), true);
  } finally { await page.close(); }
});

test('an empty or root project path shows no pill', async (t) => {
  for (const project of ['', '/']) {
    const page = await openPage(t, { project, runs: [run()] });
    if (!page) return;
    try {
      await page.waitFor("return /^Updated/.test(document.getElementById('status').textContent)");
      await page.wait(300); // /api/info is fetched once at start; give it time to arrive
      assert.equal(await page.execute("return document.getElementById('project')"), null, JSON.stringify(project));
      assert.equal(await page.execute("return !!document.getElementById('status') && !!document.getElementById('theme')"), true);
    } finally { await page.close(); }
  }
});
