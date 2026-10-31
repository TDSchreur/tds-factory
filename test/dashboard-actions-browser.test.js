import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

const click = (page, selector) => page.execute(`document.querySelector(${JSON.stringify(selector)}).click()`);
const dialog = (page) => page.execute("return document.getElementById('dialog').open ? [document.getElementById('dialog-title').textContent, document.getElementById('dialog-message').textContent] : null");
const confirmed = async (page, selector, title) => {
  await click(page, selector);
  await page.waitFor(`return document.getElementById('dialog').open && document.getElementById('dialog-title').textContent === ${JSON.stringify(title)}`);
};
const answer = async (page, title) => {
  await click(page, '#dialog-confirm');
  await page.waitFor(`return document.getElementById('dialog').open && document.getElementById('dialog-title').textContent === ${JSON.stringify(title)}`);
  const shown = await dialog(page);
  await click(page, '#dialog-confirm');
  await page.waitFor("return !document.getElementById('dialog').open");
  return shown;
};

test('Sync asks first, then posts with the session token and reports the result', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'b', title: 'Building', column: 'build' }), run({ id: 'p', title: 'Planning', column: 'define' })] });
  if (!page) return;
  try {
    assert.equal(await page.execute("return document.querySelectorAll('[aria-label$=\"with origin\"]').length"), 1);
    await confirmed(page, '[aria-label="Sync Building with origin"]', 'Sync with origin?');
    await click(page, '#dialog-cancel');
    await page.wait(200);
    assert.deepEqual(page.calls, []);
    await confirmed(page, '[aria-label="Sync Building with origin"]', 'Sync with origin?');
    assert.deepEqual(await answer(page, 'Synced'), ['Synced', 'Synced.']);
    assert.deepEqual(page.calls, ['POST /api/runs/b/sync']);
    assert.deepEqual(page.tokens, ['test-token']);
  } finally { await page.close(); }
});

test('a refused Sync shows the reason', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'b', title: 'Building', column: 'check' })], respond: () => ({ status: 409, body: 'cannot sync while the Run worktree has uncommitted changes' }) });
  if (!page) return;
  try {
    await confirmed(page, '[aria-label="Sync Building with origin"]', 'Sync with origin?');
    assert.deepEqual(await answer(page, 'Could not sync'), ['Could not sync', 'cannot sync while the Run worktree has uncommitted changes']);
  } finally { await page.close(); }
});

test('Accept Check is offered only to a Check that waits on you, and names the verdicts', async (t) => {
  const page = await openPage(t, { runs: [
    run({ id: 'w', title: 'Waiting check', column: 'check', status: 'waiting', waiting: true, standards: 'pass', spec: 'pass', security: 'fail', infrastructure: 'skipped' }),
    run({ id: 'r', title: 'Running check', column: 'check' }),
    run({ id: 'x', title: 'Waiting build', column: 'build', status: 'waiting', waiting: true }),
  ] });
  if (!page) return;
  try {
    assert.deepEqual(await page.execute("return [...document.querySelectorAll('[aria-label^=\"Accept the Check\"]')].map(b => b.getAttribute('aria-label'))"), ['Accept the Check of Waiting check']);
    await confirmed(page, '[aria-label^="Accept the Check"]', 'Accept this Check?');
    assert.match((await dialog(page))[1], /Security: fail/);
    assert.deepEqual(await answer(page, 'Accepted'), ['Accepted', 'Accepted.']);
    assert.deepEqual(page.calls, ['POST /api/runs/w/accept']);
  } finally { await page.close(); }
});

test('Clean up is offered for a merged Done Run and shows why a clean-up is refused', async (t) => {
  const done = (id, prState) => run({ id, title: id, column: 'done', status: 'done', pr: 'https://github.com/a/b/pull/1', prState });
  const page = await openPage(t, { runs: [done('merged', 'merged'), done('open', 'open')], respond: () => ({ status: 409, body: 'kept: the branch has commits that are not in the merged PR' }) });
  if (!page) return;
  try {
    await page.execute("document.querySelectorAll('[aria-expanded]').forEach(b => b.click())");
    assert.equal(await page.execute("return document.querySelectorAll('[aria-label^=\"Clean up\"]').length"), 1);
    await confirmed(page, '[aria-label="Clean up merged"]', 'Clean up Run?');
    assert.deepEqual(await answer(page, 'Could not clean'), ['Could not clean', 'kept: the branch has commits that are not in the merged PR']);
    assert.deepEqual(page.calls, ['POST /api/runs/merged/clean']);
  } finally { await page.close(); }
});

test('Needs you: a Run that starts waiting raises a browser notification, and one already waiting does not', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'old', title: 'Already waiting', waiting: true, status: 'waiting', reason: 'answer' })] });
  if (!page) return;
  try {
    assert.equal(await page.execute("return document.getElementById('notify') === null || document.getElementById('notify').textContent"), 'Notify me');
    await page.execute(`
      window.__notes = [];
      window.Notification = class { static permission = 'default'; static requestPermission() { this.permission = 'granted'; return Promise.resolve('granted'); } constructor(title, options) { window.__notes.push([title, options.body, options.tag]); } };`);
    await page.waitFor("return document.getElementById('notify')");
    await click(page, '#notify');
    await page.waitFor("return !document.getElementById('notify')");
    assert.deepEqual(await page.execute('return window.__notes'), []);
    page.state.runs = [...page.state.runs, run({ id: 'new', title: 'Now waiting', waiting: true, status: 'waiting', reason: 'confirm the shared understanding' })];
    await page.waitFor('return window.__notes.length === 1');
    assert.deepEqual(await page.execute('return window.__notes'), [['Needs you: Now waiting', 'confirm the shared understanding', 'new']]);
    await page.wait(2500);
    assert.equal(await page.execute('return window.__notes.length'), 1);
    assert.match(await page.execute('return document.title'), /^\(2\) /);
  } finally { await page.close(); }
});

test('no Notify button without notification support or once permission was decided', async (t) => {
  const page = await openPage(t, { runs: [run()] });
  if (!page) return;
  try {
    await page.execute("window.Notification = { permission: 'denied' }");
    await page.waitFor("return document.getElementById('status').textContent.startsWith('Updated')");
    await page.wait(2500);
    assert.equal(await page.execute("return document.getElementById('notify')"), null);
  } finally { await page.close(); }
});
