import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

const ESCAPE = '\uE00C';
const POLL_WAIT = 2400;

test('the board explains itself and flags Runs that wait on the user', async (t) => {
  const page = await openPage(t, { runs: [
    run({ id: 'a', title: 'Active', column: 'check', ticketsTotal: 2, ticketsDone: 1, standards: 'pass', spec: 'pass', security: 'fail', infrastructure: 'skipped', loops: 1 }),
    run({ id: 'w', title: 'Waiting', waiting: true, reason: 'confirm the plan' }),
  ] });
  if (!page) return;
  try {
    assert.equal(await page.execute("return document.querySelector('#intro').open"), false);
    assert.match(await page.execute("return document.querySelector('#intro summary').textContent"), /What is this\?/);
    assert.deepEqual(await page.execute("return [...document.querySelectorAll('#board h2')].map(h => [h.textContent, h.tabIndex, h.title.length > 20])"),
      ['Define', 'Build', 'Check', 'Finish', 'Done'].map((label) => [label, 0, true]));
    assert.deepEqual(await page.execute("return [...document.querySelectorAll('[data-stage=check] .chip')].map(c => [c.textContent, c.className, c.title.length > 10])"), [
      ['1/2 tickets', 'chip ', true], ['Standards pass', 'chip pass', true], ['Spec pass', 'chip pass', true],
      ['Security fail', 'chip fail', true], ['Infrastructure skipped', 'chip skipped', true], ['loop 1/2', 'chip ', true],
    ]);
    assert.equal(await page.execute("return document.querySelector('.card.waiting .reason').textContent"), 'Needs you: confirm the plan');
    assert.equal(await page.execute('return document.title'), '(1) test · TDS Factory');
    assert.equal(await page.execute("return document.querySelector('[data-stage=prepare]')"), null);
    assert.equal(await page.execute("return ['project', 'status', 'theme', 'older'].every(id => document.getElementById(id))"), true);
    assert.equal(await page.execute("return document.getElementById('project').textContent"), 'test');
  } finally { await page.close(); }
});

test('older Runs are folded, except those waiting on the user', async (t) => {
  const page = await openPage(t, { runs: [
    run({ id: 'new', title: 'New' }),
    run({ id: 'old', title: 'Old', updated: '2020-01-01T00:00:00Z' }),
    run({ id: 'oldw', title: 'Old waiting', updated: '2020-01-01T00:00:00Z', waiting: true }),
  ] });
  if (!page) return;
  try {
    const titles = "return [...document.querySelectorAll('.card .title')].map(e => e.textContent).sort()";
    assert.deepEqual(await page.execute(titles), ['New', 'Old waiting']);
    assert.equal(await page.execute("return document.getElementById('older').textContent"), 'Show older (1)');
    await page.execute("document.getElementById('older').click()");
    assert.deepEqual(await page.execute(titles), ['New', 'Old', 'Old waiting']);
    assert.equal(await page.execute("return document.getElementById('older').textContent"), 'Hide older runs');
  } finally { await page.close(); }
});

test('Done cards start collapsed, expand in place and stay expanded after a refresh', async (t) => {
  const done = (over) => run({ column: 'done', status: 'done', agent: 'claude', standards: 'pass', ...over });
  const page = await openPage(t, { runs: [
    done({ id: 'd', title: 'Done run' }),
    done({ id: '__proto__', title: 'Proto run' }),
    done({ id: 'x', title: 'Stopped', status: 'abandoned' }),
    run({ id: 'a', title: 'Active', agent: 'codex', standards: 'pass' }),
  ] });
  if (!page) return;
  try {
    const hidden = (title) => page.execute(`return [...document.querySelectorAll('.card')].find(c => c.querySelector('.title').textContent === '${title}').querySelector('.details').hidden`);
    assert.equal(await hidden('Done run'), true);
    assert.equal(await hidden('Proto run'), true);
    assert.equal(await page.execute("return document.querySelector('[data-stage=build] .chips .chip') !== null && !document.querySelector('[data-stage=build] .details')"), true);
    assert.match(await page.execute("return [...document.querySelectorAll('.card')].find(c => c.textContent.includes('Stopped')).textContent"), /Abandoned/);
    await page.execute("document.querySelector('[aria-label=\"Show details: Done run\"]').click()");
    assert.equal(await hidden('Done run'), false);
    assert.equal(await page.execute("return !document.querySelector('.card.selected')"), true);
    assert.equal(await page.execute("return document.querySelector('[aria-label=\"Hide details: Done run\"]').getAttribute('aria-expanded')"), 'true');
    await page.wait(POLL_WAIT);
    assert.equal(await hidden('Done run'), false);
    assert.equal(await hidden('Proto run'), true);
  } finally { await page.close(); }
});

test('a Done card shows the PR state, and only an open PR can be merged after confirming', async (t) => {
  const done = (id, prState) => run({ id, title: id, column: 'done', status: 'done', pr: 'https://github.com/a/b/pull/1', prState });
  const page = await openPage(t, { runs: [done('open', 'open'), done('merged', 'merged')] });
  if (!page) return;
  try {
    await page.execute("document.querySelectorAll('[aria-expanded]').forEach(b => b.click())");
    assert.deepEqual(await page.execute("return [...document.querySelectorAll('.pr')].map(p => p.textContent)"), ['Pull request Merged', 'Pull request Open']);
    assert.equal(await page.execute("return document.querySelectorAll('[aria-label^=\"Squash and merge\"]').length"), 1);
    assert.equal(await page.execute("return document.querySelector('.pr a').href"), 'https://github.com/a/b/pull/1');
    await page.execute("document.querySelector('[aria-label^=\"Squash and merge\"]').click()");
    await page.waitFor("return document.getElementById('dialog').open");
    assert.match(await page.execute("return document.getElementById('dialog-message').textContent"), /Merge the pull request for "open"/);
    await page.execute("document.getElementById('dialog-cancel').click()");
    assert.deepEqual(page.calls, []);
    await page.execute("document.querySelector('[aria-label^=\"Squash and merge\"]').click()");
    await page.waitFor("return document.getElementById('dialog').open");
    await page.execute("document.getElementById('dialog-confirm').click()");
    await page.wait(200);
    assert.deepEqual(page.calls, ['POST /api/runs/open/merge']);
  } finally { await page.close(); }
});

test('merge confirmation shows failing and pending GitHub checks', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'r', title: 'Example', column: 'done', status: 'done', pr: 'https://github.com/a/b/pull/1', prState: 'open' })], checks: 'GitHub checks: CI: failing; Lint: pending' });
  if (!page) return;
  try {
    await page.execute("document.querySelector('[aria-expanded]').click()");
    await page.execute("document.querySelector('[aria-label^=\"Squash and merge\"]').click()");
    await page.waitFor("return document.getElementById('dialog').open");
    assert.match(await page.execute("return document.getElementById('dialog-message').textContent"), /CI: failing; Lint: pending/);
    await page.execute("document.getElementById('dialog-cancel').click()");
    assert.deepEqual(page.calls, []);
  } finally { await page.close(); }
});

test('Escape cancels a confirmation, and the Merge button keeps keyboard focus across refreshes', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'r', title: 'Example', column: 'done', status: 'done', pr: 'https://github.com/a/b/pull/1', prState: 'open' })] });
  if (!page) return;
  try {
    await page.execute("document.querySelector('[aria-expanded]').click()");
    await page.waitFor("return !document.querySelector('.details').hidden");
    await page.execute("document.querySelector('[aria-label^=\"Squash and merge\"]').focus(); document.activeElement.click();");
    await page.waitFor("return document.querySelector('dialog').open");
    assert.equal(await page.execute("return document.querySelector('dialog').open && document.activeElement.textContent === 'Cancel'"), true);
    await page.key(ESCAPE);
    await page.wait(200);
    assert.equal(await page.execute("return !document.querySelector('dialog').open && document.activeElement.textContent === 'Merge'"), true);
    await page.wait(POLL_WAIT);
    assert.equal(await page.execute("return document.activeElement.textContent === 'Merge'"), true);
    assert.deepEqual(page.calls, []);
  } finally { await page.close(); }
});

test('active Runs offer deletion and dirty changes need separate confirmation', async (t) => {
  const page = await openPage(t, {
    runs: ['define', 'build', 'check', 'finish'].map(column => run({ id: column, title: column, column })),
    respond: (req) => req.url.includes('discardChanges=true') ? { status: 200, body: 'deleted' } : { status: 409, body: 'dirty', headers: { 'x-factory-error': 'dirty-worktree' } },
  });
  if (!page) return;
  try {
    assert.equal(await page.execute("return document.querySelectorAll('.card .actions .danger').length"), 4);
    await page.execute("document.querySelector('[data-id=build] .danger').click()");
    await page.waitFor("return document.getElementById('dialog').open");
    assert.match(await page.execute("return document.getElementById('dialog-message').textContent"), /stop.*agent/i);
    await page.execute("document.getElementById('dialog-confirm').click()");
    await page.waitFor("return document.getElementById('dialog').open && document.getElementById('dialog-title').textContent === 'Discard uncommitted changes?'");
    assert.match(await page.execute("return document.getElementById('dialog-message').textContent"), /build.*permanently.*worktree/i);
    await page.execute("document.getElementById('dialog-cancel').click()");
    assert.deepEqual(page.calls, ['DELETE /api/runs/build']);
    await page.execute("document.querySelector('[data-id=build] .danger').click()");
    await page.waitFor("return document.getElementById('dialog').open");
    await page.execute("document.getElementById('dialog-confirm').click()");
    await page.waitFor("return document.getElementById('dialog').open && document.getElementById('dialog-title').textContent === 'Discard uncommitted changes?'");
    await page.execute("document.getElementById('dialog-confirm').click()");
    await page.waitFor("return !document.getElementById('dialog').open");
    // The dialog closes before the request reaches the server, so wait for the call instead of racing it.
    for (let i = 0; i < 50 && page.calls.length < 3; i++) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(page.calls, ['DELETE /api/runs/build', 'DELETE /api/runs/build', 'DELETE /api/runs/build?discardChanges=true']);
  } finally { await page.close(); }
});

test('Delete all asks separately before discarding each dirty Run', async (t) => {
  const page = await openPage(t, {
    runs: ['a', 'b'].map(id => run({ id, title: id, column: 'done', status: 'done' })),
    respond: (req) => req.url.includes('discardChanges=true') ? { status: 200, body: 'deleted' } : { status: 409, body: 'dirty', headers: { 'x-factory-error': 'dirty-worktree' } },
  });
  if (!page) return;
  try {
    await page.execute("[...document.querySelectorAll('button')].find(b => b.textContent === 'Delete all').click()");
    await page.waitFor("return document.getElementById('dialog').open");
    await page.execute("document.getElementById('dialog-confirm').click()");
    await page.waitFor("return document.getElementById('dialog').open && document.getElementById('dialog-title').textContent === 'Discard uncommitted changes?'");
    const first = await page.execute("return document.getElementById('dialog-message').textContent");
    await page.execute("document.getElementById('dialog-cancel').click()");
    await page.waitFor("return document.getElementById('dialog').open && document.getElementById('dialog-title').textContent === 'Discard uncommitted changes?' && document.getElementById('dialog-message').textContent !== " + JSON.stringify(first));
    await page.execute("document.getElementById('dialog-confirm').click()");
    await page.waitFor("return !document.getElementById('dialog').open");
    // Closing the confirmation precedes the final request reaching the server.
    for (let i = 0; i < 50 && page.calls.length < 3; i++) await page.wait(100);
    assert.equal(page.calls.length, 3);
    assert.equal(page.calls.filter(call => call.includes('discardChanges=true')).length, 1);
    assert.equal(page.calls.filter(call => !call.includes('discardChanges=true')).length, 2);
  } finally { await page.close(); }
});

test('Delete all names the hidden older Runs and reports the Runs that fail', async (t) => {
  const done = (id, over) => run({ id, title: id, column: 'done', status: 'done', ...over });
  const page = await openPage(t, {
    runs: [done('new'), done('old', { updated: '2020-01-01T00:00:00Z' }), run({ id: 'active', title: 'active' })],
    respond: (req) => (req.url.startsWith('/api/runs/old') ? { status: 409, body: 'refused' } : { status: 200, body: 'deleted' }),
  });
  if (!page) return;
  try {
    await page.execute("[...document.querySelectorAll('button')].find(b => b.textContent === 'Delete all').click()");
    await page.waitFor("return document.getElementById('dialog').open");
    assert.match(await page.execute("return document.getElementById('dialog-message').textContent"), /2 Done Runs.*hidden older Runs/);
    await page.execute("document.getElementById('dialog-cancel').click()");
    assert.deepEqual(page.calls, []);
    await page.execute("[...document.querySelectorAll('button')].find(b => b.textContent === 'Delete all').click()");
    await page.waitFor("return document.getElementById('dialog').open");
    await page.execute("document.getElementById('dialog-confirm').click()");
    await page.waitFor("return document.getElementById('dialog').open && document.getElementById('dialog-title').textContent === 'Could not delete'");
    assert.equal(await page.execute("return document.getElementById('dialog-message').textContent"), 'old (refused)');
    assert.equal(await page.execute("return document.getElementById('dialog-cancel').hidden"), true);
    assert.deepEqual(page.calls.sort(), ['DELETE /api/runs/new?doneOnly=true', 'DELETE /api/runs/old?doneOnly=true']);
  } finally { await page.close(); }
});

test('selecting a Run shows its Markdown files as text, never as markup', async (t) => {
  const page = await openPage(t, {
    runs: [run({ id: 'r1', title: 'With files', files: ['define.md', 'build.md'], links: [{ label: 'Spec', href: 'docs/specs/x.md' }, { label: 'PR', href: 'https://example.com/pr/1' }] }), run({ id: 'r2', title: 'Bare' })],
    files: { 'r1/define.md': '# Plan\n\n- one\n- two with `code`\n\n<img src=x onerror="document.title=\'pwned\'">\n\n[ok](https://example.com) [bad](javascript:alert(1))', 'r1/build.md': '| a | b |\n|---|---|\n| 1 | 2 |' },
  });
  if (!page) return;
  try {
    await page.execute("document.querySelector('[data-id=r1]').click()");
    await page.waitFor("return document.querySelectorAll('#detail table td').length === 2");
    assert.equal(await page.execute("return document.querySelector('#detail h4').textContent"), 'Plan');
    assert.equal(await page.execute("return document.querySelectorAll('#detail li').length"), 2);
    assert.equal(await page.execute("return document.querySelector('#detail img') === null && document.title === 'test · TDS Factory'"), true);
    assert.deepEqual(await page.execute("return [...document.querySelectorAll('#detail a')].map(a => a.href)"), ['https://example.com/pr/1', 'https://example.com/']);
    assert.match(await page.execute("return document.querySelector('#detail').textContent"), /Spec: docs\/specs\/x\.md/);
    await page.execute("document.querySelector('[data-id=r2]').click()");
    assert.match(await page.execute("return document.querySelector('#detail').textContent"), /No summaries yet/);
    await page.execute("document.querySelector('[data-id=r2]').click()");
    assert.equal(await page.execute("return document.getElementById('detail').hidden"), true);
  } finally { await page.close(); }
});

test('the Run detail opens beside the board, not below the last card', async (t) => {
  const many = Array.from({ length: 12 }, (_, i) => run({ id: 'b' + i, title: 'Run ' + i, column: 'build', updated: new Date(Date.now() - i * 1000).toISOString(), files: ['define.md'] }));
  const page = await openPage(t, { runs: many, files: { 'b11/define.md': '# Last\n\ntext', 'b0/define.md': '# First\n\ntext' } });
  if (!page) return;
  try {
    await page.execute("document.querySelector('[data-id=b11]').scrollIntoView(); document.querySelector('[data-id=b11]').click()");
    await page.waitFor("return document.querySelector('#detail h4') !== null");
    const box = await page.execute("const d = document.getElementById('detail').getBoundingClientRect(); const b = document.getElementById('board').getBoundingClientRect(); return { dLeft: d.left, bRight: b.right, dTop: d.top, dBottom: d.bottom, h: innerHeight }");
    assert.ok(box.dLeft >= box.bRight - 1, 'the Run detail sits right of the board');
    assert.ok(box.dTop >= 0 && box.dTop < box.h && box.dBottom <= box.h + 1, 'the Run detail is in view');
    assert.equal(await page.execute("return document.querySelector('[data-id=b11]').classList.contains('selected')"), true);
    // The board stays clickable: another card switches the Run detail.
    await page.execute("document.querySelector('[data-id=b0]').click()");
    await page.waitFor("return document.querySelector('#detail h4')?.textContent === 'First'");
    assert.equal(await page.execute("return document.querySelector('#detail h2').textContent"), 'Run 0');
    // The close button closes it and leaves only the board.
    await page.execute("document.querySelector('#detail button[aria-label=\"Close Run detail\"]').click()");
    assert.equal(await page.execute("return document.getElementById('detail').hidden"), true);
    assert.equal(await page.execute("return document.querySelector('.card.selected')"), null);
  } finally { await page.close(); }
});

test('the Run detail header shows the Run state and stays in view while the summaries scroll', async (t) => {
  const page = await openPage(t, {
    runs: [run({ id: 'w', title: 'Waiting run', column: 'check', waiting: true, reason: 'confirm the plan', agent: 'claude', ticketsTotal: 2, ticketsDone: 1, standards: 'pass', files: ['define.md'], links: [{ label: 'Spec', href: 'docs/specs/x.md' }] }),
      run({ id: 'x', title: 'Dropped', column: 'done', status: 'abandoned' })],
    files: { 'w/define.md': '# Long\n\n' + Array.from({ length: 150 }, (_, i) => `- finding ${i}`).join('\n') },
  });
  if (!page) return;
  try {
    await page.execute("document.querySelector('[data-id=w]').click()");
    await page.waitFor("return document.querySelectorAll('#detail li').length > 100");
    const head = await page.execute("return document.querySelector('#detail header').textContent");
    for (const part of ['Waiting run', 'Check', 'Needs you: confirm the plan', '1/2 tickets', 'Standards pass', 'claude', 'Updated']) assert.ok(head.includes(part), part + ' in ' + head);
    assert.equal(await page.execute("const b = document.querySelector('#detail header button[aria-label=\"Close Run detail\"]').getBoundingClientRect(); return document.getElementById('detail').getBoundingClientRect().right - b.right < 40"), true); // at the right edge
    await page.execute("document.getElementById('detail').scrollTop = 600");
    const gap = await page.execute("return document.querySelector('#detail header').getBoundingClientRect().top - document.getElementById('detail').getBoundingClientRect().top");
    assert.ok(Math.abs(gap) <= 2, 'the header stays at the top of the Run detail, gap ' + gap);
    await page.execute("document.querySelector('[data-id=x]').click()");
    assert.match(await page.execute("return document.querySelector('#detail header').textContent"), /Done.*Abandoned/s);
  } finally { await page.close(); }
});

test('the Run detail is keyboard friendly: focus moves in, Escape closes it and focus returns to the card', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'r1', title: 'One', files: ['define.md'] }), run({ id: 'r2', title: 'Two' })], files: { 'r1/define.md': 'text' } });
  if (!page) return;
  try {
    assert.equal(await page.execute("return document.getElementById('detail').getAttribute('aria-label')"), 'Run detail');
    await page.execute("document.querySelector('[data-id=r1]').focus(); document.querySelector('[data-id=r1]').click()");
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')");
    await page.wait(POLL_WAIT); // a poll must not take focus away again
    await page.execute("document.querySelector('#detail a, #detail button').focus()");
    await page.wait(POLL_WAIT);
    assert.equal(await page.execute("return document.activeElement.closest('#detail') !== null"), true);
    await page.key(ESCAPE);
    assert.equal(await page.execute("return document.getElementById('detail').hidden"), true);
    assert.equal(await page.execute("return document.activeElement === document.querySelector('[data-id=r1]')"), true);
    // Escape with nothing open does nothing.
    await page.key(ESCAPE);
    assert.equal(await page.execute("return document.getElementById('detail').hidden"), true);
    // The close button hands focus back to the card too.
    await page.execute("document.querySelector('[data-id=r1]').click()");
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')");
    await page.execute("document.querySelector('#detail button[aria-label=\"Close Run detail\"]').click()");
    assert.equal(await page.execute("return document.activeElement === document.querySelector('[data-id=r1]')"), true);
  } finally { await page.close(); }
});

test('on a narrow screen the Run detail is a full-screen sheet with a close button', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'r1', title: 'One', files: ['define.md'] })], files: { 'r1/define.md': 'text' } }, { width: 500 });
  if (!page) return;
  try {
    await page.execute("document.querySelector('[data-id=r1]').click()");
    await page.waitFor("return !document.getElementById('detail').hidden");
    const box = await page.execute("const d = document.getElementById('detail').getBoundingClientRect(); return { l: d.left, t: d.top, w: d.width, h: d.height, vw: innerWidth, vh: innerHeight }");
    assert.ok(box.l <= 1 && box.t <= 1 && box.w >= box.vw - 20 && box.h >= box.vh - 1, 'the sheet covers the screen: ' + JSON.stringify(box));
    await page.execute("document.querySelector('#detail button[aria-label=\"Close Run detail\"]').click()");
    assert.equal(await page.execute("return document.getElementById('detail').hidden"), true);
    assert.equal(await page.execute("const c = document.querySelector('[data-id=r1]').getBoundingClientRect(); return c.width > 0 && c.top < innerHeight"), true);
  } finally { await page.close(); }
});

test('switching to another Run opens its detail at the top', async (t) => {
  const long = '# Long\n\n' + Array.from({ length: 150 }, (_, i) => `- finding ${i}`).join('\n');
  const page = await openPage(t, { runs: [run({ id: 'a', title: 'A', files: ['define.md'] }), run({ id: 'b', title: 'B', files: ['define.md'] })], files: { 'a/define.md': long, 'b/define.md': long } });
  if (!page) return;
  try {
    await page.execute("document.querySelector('[data-id=a]').click()");
    await page.waitFor("return document.querySelectorAll('#detail li').length > 100");
    await page.execute("document.getElementById('detail').scrollTop = 800");
    await page.execute("document.querySelector('[data-id=b]').click()");
    await page.waitFor("return document.querySelector('#detail h2').textContent === 'B'");
    assert.equal(await page.execute("return document.getElementById('detail').scrollTop"), 0);
  } finally { await page.close(); }
});

test('the Run detail closes when its Run is no longer shown', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'r1', title: 'Going' }), run({ id: 'r2', title: 'Staying' })] });
  if (!page) return;
  try {
    await page.execute("document.querySelector('[data-id=r1]').click()");
    assert.equal(await page.execute("return document.getElementById('detail').hidden"), false);
    page.state.runs = [run({ id: 'r2', title: 'Staying' })];
    await page.wait(POLL_WAIT);
    assert.equal(await page.execute("return document.getElementById('detail').hidden"), true);
    page.state.runs = [run({ id: 'r1', title: 'Going' }), run({ id: 'r2', title: 'Staying' })];
    await page.wait(POLL_WAIT);
    assert.equal(await page.execute("return document.getElementById('detail').hidden"), true); // it does not reopen by itself
  } finally { await page.close(); }
});

test('a failed refresh keeps the last data and says so', async (t) => {
  const page = await openPage(t, { runs: [run({ id: 'r', title: 'Kept' })] });
  if (!page) return;
  try {
    page.state.failViews = true;
    await page.waitFor("return document.getElementById('status').className === 'error'");
    assert.match(await page.execute("return document.getElementById('status').textContent"), /Cannot reach the server \(HTTP 500\).*showing last data/);
    assert.equal(await page.execute("return document.querySelectorAll('.card').length"), 1);
    page.state.failViews = false;
    await page.waitFor("return document.getElementById('status').className === '' && /^Updated/.test(document.getElementById('status').textContent)");
  } finally { await page.close(); }
});

test('card buttons are visibly distinct: filled Merge, warning Delete, link-style toggle', async (t) => {
  const page = await openPage(t, { runs: [
    run({ id: 'o', title: 'Open', column: 'done', status: 'done', pr: 'https://github.com/o/r/pull/1', prState: 'open' }),
  ] });
  if (!page) return;
  try {
    await page.execute("document.querySelector('[aria-expanded]').click()");
    await page.waitFor("return !document.querySelector('.details').hidden");
    const css = (sel, prop) => page.execute(`return getComputedStyle(document.querySelector('${sel}')).${prop}`);
    const [merge, del, card] = [await css('.actions .primary', 'backgroundColor'), await css('.actions .danger', 'color'), await css('.card', 'backgroundColor')];
    assert.notEqual(merge, card);
    assert.notEqual(merge, await css('.actions .danger', 'backgroundColor'));
    assert.notEqual(del, await css('.card', 'color'));
    assert.equal(await page.execute("return document.querySelector('.pr .badge.open').textContent"), 'Open');
    assert.equal(await page.execute("return document.querySelector('.meta .updated') !== null"), true);
  } finally { await page.close(); }
});

test('a collapsed Done card with an open pull request shows an Open PR badge', async (t) => {
  const page = await openPage(t, { runs: [
    run({ id: 'o', title: 'Open one', column: 'done', status: 'done', pr: 'https://github.com/o/r/pull/1', prState: 'open' }),
    run({ id: 'm', title: 'Merged one', column: 'done', status: 'done', pr: 'https://github.com/o/r/pull/2', prState: 'merged' }),
  ] });
  if (!page) return;
  try {
    const badge = (title) => page.execute(`const c = [...document.querySelectorAll('.card')].find(c => c.querySelector('.title').textContent === '${title}'); const b = c.querySelector('.open-pr'); return b ? [b.textContent, c.querySelector('.details').hidden] : null`);
    assert.deepEqual(await badge('Open one'), ['Open PR', true]);
    assert.equal(await badge('Merged one'), null);
  } finally { await page.close(); }
});

test('cards and detail distinguish paused Runs from waiting on a person', async (t) => {
  const page = await openPage(t, { runs: [
    run({ id: 'w', waiting: true, reason: 'answer' }),
    run({ id: 'v', status: 'verification-unavailable', reason: 'no compiler' }),
    run({ id: 'i', status: 'interrupted', reason: 'signal' }),
  ] });
  if (!page) return;
  try {
    assert.deepEqual(await page.execute("return [...document.querySelectorAll('.card .reason')].map(x => x.textContent).sort()"), ['Agent interrupted: signal', 'Needs you: answer', 'Verification unavailable: no compiler']);
    assert.equal(await page.execute("return document.querySelectorAll('.card.waiting').length"), 1);
    await page.execute("document.querySelector('[data-id=i]').click()");
    assert.equal(await page.execute("return document.querySelector('#detail .reason').textContent"), 'Agent interrupted: signal');
  } finally { await page.close(); }
});
