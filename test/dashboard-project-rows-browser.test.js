import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

/** @import { Page } from './browser.js' */

const COLLAPSE_KEY = 'dashboard-collapsed-projects';

/** @param {Page} page @param {string} script */
const run$ = (page, script) => page.execute(script);

/** The names of the Project rows, in page order. @param {Page} page */
const rowNames = (page) =>
  run$(page, "return [...document.querySelectorAll('.project-row h2')].map(h => h.textContent.trim())");

/** @param {Page} page @param {string} name */
const toggleOf = (page, name) =>
  run$(
    page,
    `const row = [...document.querySelectorAll('.project-row')].find(r => r.querySelector('h2').textContent.trim() === ${JSON.stringify(name)});
     return row && row.querySelector('h2 button') ? { expanded: row.querySelector('h2 button').getAttribute('aria-expanded'), columns: !!row.querySelector('.project-columns') } : null;`,
  );

/** @param {Page} page @param {string} name */
const clickToggle = (page, name) =>
  run$(
    page,
    `[...document.querySelectorAll('.project-row')].find(r => r.querySelector('h2').textContent.trim() === ${JSON.stringify(name)}).querySelector('h2 button').click()`,
  );

const two = () => [
  { id: 'a1', name: 'alpha', runs: [run({ id: 'r', title: 'Alpha run', column: 'build' })] },
  { id: 'b2', name: 'beta', runs: [run({ id: 'r', title: 'Beta run', column: 'check' })] },
];

test('every Project has a labelled row under one sticky row of Stage headers, and equal Run ids stay apart', async (t) => {
  const page = await openPage(t, { projects: two() });
  if (!page) return;
  try {
    assert.equal(await run$(page, "return document.querySelectorAll('.stage-headers').length"), 1);
    assert.deepEqual(
      await run$(page, "return [...document.querySelectorAll('.stage-headers h2')].map(h => h.textContent)"),
      ['Define', 'Build', 'Check', 'Finish', 'Follow-up', 'Done'],
    );
    assert.equal(
      await run$(page, "return getComputedStyle(document.querySelector('.stage-headers')).position"),
      'sticky',
    );
    assert.equal(
      await run$(
        page,
        "return Math.round(parseFloat(getComputedStyle(document.querySelector('.stage-headers')).top)) === Math.round(document.querySelector('header').getBoundingClientRect().height)",
      ),
      true,
      'the Stage headers stick right below the page header',
    );
    assert.deepEqual(await rowNames(page), ['alpha', 'beta']);
    assert.deepEqual(
      await run$(
        page,
        `return [...document.querySelectorAll('.project-row')].map(r => [r.getAttribute('role') || r.tagName, document.getElementById(r.getAttribute('aria-labelledby')).textContent.trim()])`,
      ),
      [
        ['SECTION', 'alpha'],
        ['SECTION', 'beta'],
      ],
    );
    assert.equal(
      await run$(
        page,
        `const left = (row) => document.querySelectorAll('.project-row')[row].querySelector('.column[data-stage=build]').getBoundingClientRect().left;
         return left(0) === left(1) && left(0) === document.querySelector('.stage-headers h2:nth-child(2)').getBoundingClientRect().left`,
      ),
      true,
      'the Stage columns of every row line up under the shared headers',
    );
    assert.deepEqual(
      await run$(
        page,
        "return [...document.querySelectorAll('.card')].map(c => c.closest('.project-row').querySelector('h2').textContent.trim() + ':' + c.dataset.id)",
      ),
      ['alpha:r', 'beta:r'],
    );
    await run$(page, "document.querySelectorAll('.card')[1].click()");
    await page.waitFor("return document.getElementById('detail').open");
    assert.deepEqual(
      await run$(page, "return [...document.querySelectorAll('.card')].map(c => c.classList.contains('selected'))"),
      [false, true],
      'only the Run of that Project is selected',
    );
    assert.match(await run$(page, "return document.getElementById('detail').textContent"), /Project: beta/);
    assert.match(await run$(page, "return document.querySelector('#detail h2').textContent"), /Beta run/);
  } finally {
    await page.close();
  }
});

test('a Project row collapses to one line with its Runs per Stage and a waiting badge, and stays collapsed after a reload', async (t) => {
  const projects = two();
  projects[0].runs.push(
    run({ id: 'w', title: 'Needs answer', column: 'build', waiting: true, status: 'waiting', reason: 'answer' }),
  );
  const page = await openPage(t, { projects });
  if (!page) return;
  try {
    assert.deepEqual(await toggleOf(page, 'alpha'), { expanded: 'true', columns: true });
    await clickToggle(page, 'alpha');
    assert.deepEqual(await toggleOf(page, 'alpha'), { expanded: 'false', columns: false });
    assert.deepEqual(await toggleOf(page, 'beta'), { expanded: 'true', columns: true });
    assert.equal(
      await run$(
        page,
        "return document.querySelector('.project-row .row-summary').innerText.replace(/\\s+/g, ' ').trim()",
      ),
      'Define 0 Build 2 Check 0 Finish 0 Follow-up 0 Done 0 1 waiting',
    );
    assert.equal(
      await run$(page, "return document.querySelector('.project-row .row-waiting').textContent"),
      '1 waiting',
    );
    assert.deepEqual(JSON.parse(await run$(page, `return localStorage.getItem('${COLLAPSE_KEY}')`)), { a1: true });
    await page.load();
    await page.waitFor("return !!document.querySelector('.project-row')");
    assert.deepEqual(await toggleOf(page, 'alpha'), { expanded: 'false', columns: false });
    assert.deepEqual(await toggleOf(page, 'beta'), { expanded: 'true', columns: true });
    await clickToggle(page, 'alpha');
    assert.deepEqual(await toggleOf(page, 'alpha'), { expanded: 'true', columns: true });
  } finally {
    await page.close();
  }
});

test('blocked or corrupt storage never breaks the page and the row still toggles', async (t) => {
  const page = await openPage(t, { projects: two() });
  if (!page) return;
  try {
    await run$(
      page,
      `localStorage.setItem('${COLLAPSE_KEY}', '{not json'); Storage.prototype.setItem = function () { throw new Error('blocked'); };`,
    );
    await page.load();
    await page.waitFor("return !!document.querySelector('.project-row')");
    assert.deepEqual(await toggleOf(page, 'alpha'), { expanded: 'true', columns: true });
    await run$(page, 'Storage.prototype.setItem = function () { throw new Error("blocked"); };');
    await clickToggle(page, 'alpha');
    assert.deepEqual(await toggleOf(page, 'alpha'), { expanded: 'false', columns: false });
  } finally {
    await page.close();
  }
});

test('a Run that starts waiting never expands a collapsed row, and neither does Needs you', async (t) => {
  const page = await openPage(t, { projects: two() }, { pollMs: 100 });
  if (!page) return;
  try {
    await clickToggle(page, 'beta');
    page.state.projects = two().map((p) => ({
      ...p,
      runs: [
        ...p.runs,
        run({ id: 'new-' + p.id, title: 'Now waiting ' + p.id, waiting: true, status: 'waiting', reason: 'q' }),
      ],
    }));
    await page.waitFor("return document.getElementById('needs-you').textContent === 'Needs you (2)'");
    assert.deepEqual(await toggleOf(page, 'beta'), { expanded: 'false', columns: false });
    assert.equal(
      await run$(page, "return document.querySelectorAll('.project-row')[1].querySelector('.row-waiting').textContent"),
      '1 waiting',
    );
    await run$(page, "document.getElementById('needs-you').click()");
    await page.waitFor("return document.getElementById('needs-you').getAttribute('aria-pressed') === 'true'");
    assert.deepEqual(await toggleOf(page, 'beta'), { expanded: 'false', columns: false });
    assert.deepEqual(await toggleOf(page, 'alpha'), { expanded: 'true', columns: true });
    assert.deepEqual(
      await run$(
        page,
        "return [...document.querySelectorAll('.project-row')[0].querySelectorAll('.card')].map(c => c.dataset.id)",
      ),
      ['new-a1'],
    );
  } finally {
    await page.close();
  }
});

test('Project rows are in stable alphabetical order, and ?project= puts its row first and expanded', async (t) => {
  const projects = ['zeta', 'Mid', 'alpha'].map((name) => ({
    id: name.toLowerCase(),
    name,
    runs: [run({ id: 'r-' + name, title: name + ' run' })],
  }));
  const page = await openPage(t, { projects }, { pollMs: 100 });
  if (!page) return;
  try {
    assert.deepEqual(await rowNames(page), ['alpha', 'Mid', 'zeta']);
    page.state.projects = [...projects].reverse();
    await page.waitForPolls(); // a poll after the registry changed had its chance to move the rows
    assert.deepEqual(await rowNames(page), ['alpha', 'Mid', 'zeta'], 'registry order does not move the rows');
    await clickToggle(page, 'zeta');
    await page.load();
    await page.waitFor("return !!document.querySelector('.project-row')");
    assert.deepEqual(await toggleOf(page, 'zeta'), { expanded: 'false', columns: false });
  } finally {
    await page.close();
  }
  const linked = await openPage(t, { projects }, { query: '?project=zeta' });
  if (!linked) return;
  try {
    await run$(linked, `localStorage.setItem('${COLLAPSE_KEY}', JSON.stringify({ zeta: true }))`);
    await linked.load();
    await linked.waitFor("return !!document.querySelector('.project-row')");
    assert.deepEqual(await rowNames(linked), ['zeta', 'alpha', 'Mid']);
    assert.deepEqual(await toggleOf(linked, 'zeta'), { expanded: 'true', columns: true });
  } finally {
    await linked.close();
  }
});

test('missing Projects appear in one collapsed summary row with per-Project Remove and Remove all missing', async (t) => {
  const page = await openPage(t, {
    projects: [
      { id: 'e1', name: 'empty-one', path: '/tmp/empty-one', runs: [] },
      { id: 'm1', name: 'gone', path: '/tmp/gone', missing: true },
      { id: 'm2', name: 'gone-too', path: '/tmp/gone-too', missing: true },
      ...two(),
    ],
  });
  if (!page) return;
  try {
    assert.deepEqual(await rowNames(page), ['alpha', 'beta', 'empty-one', '2 missing Projects']);
    const text = (/** @type {string} */ name) =>
      run$(
        page,
        `return [...document.querySelectorAll('.project-row')].find(r => r.querySelector('h2').textContent.trim() === '${name}').textContent.replace(/\\s+/g, ' ')`,
      );
    assert.match(await text('empty-one'), /No Runs/);
    assert.equal(
      await run$(page, "return [...document.querySelectorAll('.project-row')][2].querySelectorAll('.column').length"),
      0,
    );
    assert.match(await text('2 missing Projects'), /Expand to review and remove missing Projects/i);
    assert.equal(
      await run$(
        page,
        "return [...document.querySelectorAll('.project-row')][3].querySelectorAll('.column, .card').length",
      ),
      0,
    );
    await clickToggle(page, '2 missing Projects');
    assert.equal(
      await run$(
        page,
        "return [...document.querySelectorAll('.project-row')][3].querySelector('[role=region][aria-label=\"Missing Projects\"]') !== null",
      ),
      true,
    );
    assert.deepEqual(
      await run$(
        page,
        "return [...document.querySelectorAll('.missing-list li strong')].map(s => s.textContent.trim())",
      ),
      ['gone', 'gone-too'],
    );
    await run$(
      page,
      "[...document.querySelectorAll('.missing-list button')].find(b => b.textContent === 'Remove').click()",
    );
    await page.waitFor("return document.getElementById('dialog').open");
    assert.match(await run$(page, "return document.getElementById('dialog-message').textContent"), /gone/);
    assert.deepEqual(page.calls, []);
    await run$(page, "document.getElementById('dialog-cancel').click()");
    await page.waitFor("return !document.getElementById('dialog').open");
    assert.deepEqual(page.calls, []);
    await run$(
      page,
      "[...document.querySelectorAll('.missing-list button')].find(b => b.textContent === 'Remove').click()",
    );
    await page.waitFor("return document.getElementById('dialog').open");
    await run$(page, "document.getElementById('dialog-confirm').click()");
    for (let i = 0; i < 40 && !page.calls.length; i++) await page.wait(50);
    assert.deepEqual(page.calls, ['DELETE /api/projects/m1']);
    assert.deepEqual(page.tokens, ['test-token']);
    page.calls.length = 0;
    page.tokens.length = 0;
    assert.equal(
      await run$(
        page,
        "return [...document.querySelectorAll('.project-row button')].find(b => b.textContent === 'Remove all missing').getAttribute('aria-label')",
      ),
      'Remove all missing, 2 Projects',
    );
    await run$(
      page,
      "[...document.querySelectorAll('.project-row button')].find(b => b.textContent === 'Remove all missing').click()",
    );
    await page.waitFor("return document.getElementById('dialog').open");
    assert.match(
      await run$(page, "return document.getElementById('dialog-message').textContent"),
      /No folder or Run is touched/i,
    );
    assert.match(
      await run$(page, "return document.getElementById('dialog-message').textContent"),
      /missing at that moment/i,
    );
    await run$(page, "document.getElementById('dialog-confirm').click()");
    for (let i = 0; i < 40 && !page.calls.length; i++) await page.wait(50);
    assert.deepEqual(page.calls, ['DELETE /api/projects/missing']);
    assert.deepEqual(page.tokens, ['test-token']);
  } finally {
    await page.close();
  }
});

test('the row toggle works from the keyboard with Enter and Space', async (t) => {
  const page = await openPage(t, { projects: two() });
  if (!page) return;
  try {
    await run$(page, "document.querySelector('.project-row h2 button').focus()");
    await page.key('\uE007'); // Enter
    assert.deepEqual(await toggleOf(page, 'alpha'), { expanded: 'false', columns: false });
    assert.equal(
      await run$(page, "return document.activeElement === document.querySelector('.project-row h2 button')"),
      true,
      'the focus stays on the toggle',
    );
    await page.key(' ');
    assert.deepEqual(await toggleOf(page, 'alpha'), { expanded: 'true', columns: true });
  } finally {
    await page.close();
  }
});

test('the compact view keeps one Stage for every row and sums the Stage counts over all Projects', async (t) => {
  const projects = two();
  projects[1].runs.push(
    run({ id: 'q', title: 'Waiting beta', column: 'build', waiting: true, status: 'waiting', reason: 'q' }),
  );
  const page = await openPage(t, { projects }, { width: 800 });
  if (!page) return;
  try {
    assert.deepEqual(
      await run$(
        page,
        "return [...document.querySelectorAll('nav[aria-label=Stages] button')].map(b => b.textContent.replace(/\\s+/g, ' ').trim())",
      ),
      ['Define (0)', 'Build (2) Needs you', 'Check (1)', 'Finish (0)', 'Follow-up (0)', 'Done (0)'],
    );
    assert.equal(await run$(page, "return getComputedStyle(document.querySelector('.stage-headers')).display"), 'none');
    await run$(
      page,
      "[...document.querySelectorAll('nav[aria-label=Stages] button')].find(b => b.textContent.startsWith('Check')).click()",
    );
    await page.waitFor("return document.querySelector('.column[data-stage=check][data-active=true]')");
    assert.deepEqual(
      await run$(
        page,
        "return [...document.querySelectorAll('.project-row')].map(r => [...r.querySelectorAll('.column')].filter(c => getComputedStyle(c).display !== 'none').map(c => c.dataset.stage))",
      ),
      [['check'], ['check']],
    );
    const tops = await run$(
      page,
      "return [...document.querySelectorAll('.project-row')].map(r => Math.round(r.getBoundingClientRect().top))",
    );
    assert.ok(tops[1] > tops[0], 'the rows stack');
    await clickToggle(page, 'alpha');
    assert.deepEqual(await toggleOf(page, 'alpha'), { expanded: 'false', columns: false });
  } finally {
    await page.close();
  }
});

test('a notification names the Project, and opening it expands the collapsed row of its Run', async (t) => {
  const page = await openPage(t, { projects: two() }, { pollMs: 100 });
  if (!page) return;
  try {
    await run$(
      page,
      `window.__notes = [];
      window.Notification = class { static permission = 'granted'; constructor(title, options) { window.__notes.push([title, options.tag]); window.__last = this; } };`,
    );
    await page.waitForPolls(); // the Runs that already wait have been seen, so only a new one notifies
    await clickToggle(page, 'beta');
    page.state.projects = two().map((p) => ({
      ...p,
      runs:
        p.id === 'b2'
          ? [...p.runs, run({ id: 'r', title: 'Same id', waiting: true, status: 'waiting', reason: 'q' })].slice(1)
          : p.runs,
    }));
    await page.waitFor('return window.__notes.length === 1');
    assert.deepEqual(await run$(page, 'return window.__notes'), [['Needs you in beta: Same id', 'b2/r']]);
    assert.deepEqual(await toggleOf(page, 'beta'), { expanded: 'false', columns: false });
    await run$(page, 'window.__last.onclick()');
    await page.waitFor("return document.getElementById('detail').open");
    assert.deepEqual(await toggleOf(page, 'beta'), { expanded: 'true', columns: true });
    assert.match(await run$(page, "return document.getElementById('detail').textContent"), /Project: beta/);
  } finally {
    await page.close();
  }
});

test('the Done expansion belongs to one Project when two Runs share an id', async (t) => {
  const done = (/** @type {string} */ title) => run({ id: 'd', title, column: 'done', status: 'done' });
  const page = await openPage(t, {
    projects: [
      { id: 'a1', name: 'alpha', runs: [done('Alpha done')] },
      { id: 'b2', name: 'beta', runs: [done('Beta done')] },
    ],
  });
  if (!page) return;
  try {
    await run$(page, "document.querySelectorAll('.card .toggle')[1].click()");
    assert.deepEqual(
      await run$(
        page,
        "return [...document.querySelectorAll('.card .toggle')].map(b => b.getAttribute('aria-expanded'))",
      ),
      ['false', 'true'],
    );
  } finally {
    await page.close();
  }
});

test('the Needs you filter never changes the Stage counts or the waiting badge of a collapsed row', async (t) => {
  const projects = two();
  projects[0].runs.push(
    run({ id: 'w', title: 'Needs answer', column: 'build', waiting: true, status: 'waiting', reason: 'answer' }),
  );
  const page = await openPage(t, { projects });
  if (!page) return;
  const summary = () =>
    run$(page, "return document.querySelector('.project-row .row-summary').innerText.replace(/\\s+/g, ' ').trim()");
  try {
    await clickToggle(page, 'alpha');
    const before = await summary();
    assert.equal(before, 'Define 0 Build 2 Check 0 Finish 0 Follow-up 0 Done 0 1 waiting');
    await run$(page, "document.getElementById('needs-you').click()");
    await page.waitFor("return document.getElementById('needs-you').getAttribute('aria-pressed') === 'true'");
    assert.equal(await summary(), before);
  } finally {
    await page.close();
  }
});

test('the Delete all button names its Project', async (t) => {
  const done = (/** @type {string} */ id) => run({ id, title: 'Done ' + id, column: 'done', status: 'done' });
  const page = await openPage(t, {
    projects: [
      { id: 'a1', name: 'alpha', runs: [done('x')] },
      { id: 'b2', name: 'beta', runs: [done('y')] },
    ],
  });
  if (!page) return;
  try {
    assert.deepEqual(
      await run$(
        page,
        "return [...document.querySelectorAll('.project-row')].map(r => r.querySelector('.column[data-stage=done] > button').getAttribute('aria-label'))",
      ),
      ['Delete all Done Runs of alpha', 'Delete all Done Runs of beta'],
    );
  } finally {
    await page.close();
  }
});

test('a focused card is not hidden under the sticky page and Stage headers', async (t) => {
  const projects = Array.from({ length: 6 }, (_, i) => ({
    id: 'p' + i,
    name: 'project' + i,
    runs: [run({ id: 'r', title: 'Run ' + i, column: 'build' })],
  }));
  const page = await openPage(t, { projects }, { height: 500 });
  if (!page) return;
  try {
    const clearance = await run$(
      page,
      `window.scrollTo(0, document.body.scrollHeight);
       document.querySelector('.project-row .card').scrollIntoView({ block: 'nearest' });
       const stages = document.querySelector('.stage-headers').getBoundingClientRect();
       return document.querySelector('.project-row .card').getBoundingClientRect().top - stages.bottom;`,
    );
    assert.ok(clearance >= 0, 'the focused card starts below the Stage headers, not under them: ' + clearance);
  } finally {
    await page.close();
  }
});
