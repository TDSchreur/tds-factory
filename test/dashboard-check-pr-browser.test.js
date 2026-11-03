import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

/** @import { Page } from './browser.js' */

const PR = 'https://github.com/o/r/pull/1';
const doneRun = (/** @type {Record<string, unknown>} */ over = {}) =>
  run({
    id: 'd',
    title: 'Done one',
    column: 'done',
    status: 'done',
    pr: PR,
    prHost: 'github',
    prState: 'open',
    ...over,
  });
/** @param {Page} page */
const buttons = (page) =>
  page.execute(
    "return [...document.querySelectorAll('.card [aria-label^=\"Check PR: the pull request of\"]')].map(b => b.getAttribute('aria-label'))",
  );
/** @param {Page} page @param {string} id */
const check = async (page, id) => {
  await page.waitFor(`return !!document.querySelector('[data-id=${id}]')`);
  await page.execute(
    `const card = document.querySelector('[data-id=${id}]'); const d = card.querySelector('.details'); if (d) d.hidden = false; card.querySelector('[aria-label^="Check PR: the pull request of"]').click()`,
  );
  await page.waitFor(
    "return document.getElementById('detail').open && !!document.querySelector('#detail .pr-details h4')",
  );
};
/** @param {Page} page */
const drawer = (page) =>
  page.execute("return document.querySelector('#detail .pr-details').innerText.replace(/\\s+/g, ' ').trim()");

test('Check PR shows only for a Done Run with an open pull request and for a Run in Follow-up', async (t) => {
  const page = await openPage(t, {
    runs: [
      doneRun(),
      doneRun({ id: 'merged', title: 'Merged', prState: 'merged' }),
      doneRun({ id: 'nopr', title: 'No PR', pr: '', prHost: '' }),
      run({ id: 'fu', title: 'Follow', column: 'follow-up', pr: PR, prHost: 'github' }),
      run({ id: 'b', title: 'Build', column: 'build', pr: PR, prHost: 'github' }),
    ],
  });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=fu]')");
    assert.deepEqual((await buttons(page)).sort(), [
      'Check PR: the pull request of Done one',
      'Check PR: the pull request of Follow',
    ]);
  } finally {
    await page.close();
  }
});

test('the drawer lists state, conflicts, failing and pending checks and unresolved threads', async (t) => {
  const page = await openPage(t, {
    runs: [doneRun()],
    detailsBody: {
      state: 'open',
      draft: true,
      conflicts: true,
      failing: [{ name: 'Tests', url: 'https://github.com/o/r/actions/runs/1' }],
      pending: ['lint'],
      threads: [{ path: 'src/a.js', comment: 'Please rename', url: 'https://github.com/o/r/pull/1#r1' }],
      threadsTotal: 3,
    },
  });
  if (!page) return;
  try {
    await check(page, 'd');
    const text = await drawer(page);
    assert.match(text, /State: open \(draft\)/);
    assert.match(text, /Merge conflicts: yes/);
    assert.match(text, /Failing checks Tests/);
    assert.match(text, /Pending checks lint/);
    assert.match(text, /src\/a\.js: Please rename Open the thread/);
    assert.match(text, /2 more not shown/);
    assert.equal(
      await page.execute("return document.querySelector('#detail .pr-failing a').href"),
      'https://github.com/o/r/actions/runs/1',
    );
    assert.equal(
      await page.execute("return document.querySelector('#detail .pr-failing a').rel"),
      'noopener noreferrer',
    );
    assert.match(
      await page.execute("return document.querySelector('#detail [role=status].sr').textContent"),
      /Pull request checked/,
    );
    assert.equal(page.state.detailsCalls?.length, 1);
  } finally {
    await page.close();
  }
});

test('a merged pull request shows its state only', async (t) => {
  const page = await openPage(t, {
    runs: [run({ id: 'fu', title: 'Follow', column: 'follow-up', pr: PR, prHost: 'github' })],
    detailsBody: { state: 'merged' },
  });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=fu]')");
    await page.execute('document.querySelector(\'[aria-label^="Check PR: the pull request of"]\').click()');
    await page.waitFor("return /State: merged/.test(document.querySelector('#detail .pr-details')?.textContent ?? '')");
    const text = await drawer(page);
    assert.doesNotMatch(text, /Failing checks|conflicts|Pending|threads/);
  } finally {
    await page.close();
  }
});

for (const [host, steps] of [
  ['github', ['Install the GitHub CLI from https://cli.github.com', 'Run `gh auth login`']],
  ['azure-devops', ['Install the Azure CLI', 'Run `az login`']],
]) {
  test(`${host} setup steps are shown when the host tool is missing`, async (t) => {
    const page = await openPage(t, {
      runs: [doneRun({ prHost: host })],
      detailsBody: { unavailable: 'gh-missing', setup: steps },
    });
    if (!page) return;
    try {
      await page.waitFor("return !!document.querySelector('[data-id=d]')");
      await page.execute('document.querySelector(\'[aria-label^="Check PR: the pull request of"]\').click()');
      await page.waitFor("return !!document.querySelector('#detail .pr-setup')");
      const items = await page.execute(
        "return [...document.querySelectorAll('#detail .pr-setup li')].map(li => li.textContent)",
      );
      assert.deepEqual(items, steps);
      assert.match(await drawer(page), /could not be read: gh-missing/);
    } finally {
      await page.close();
    }
  });
}

test('a refused lookup says why', async (t) => {
  const page = await openPage(t, { runs: [doneRun()], detailsStatus: 409, detailsBody: 'not eligible' });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=d]')");
    await page.execute('document.querySelector(\'[aria-label^="Check PR: the pull request of"]\').click()');
    await page.waitFor("return /not eligible/.test(document.querySelector('#detail .pr-details')?.textContent ?? '')");
  } finally {
    await page.close();
  }
});

test('hostile PR text renders as text and a javascript: link is not an anchor', async (t) => {
  const hostile = '<img src=x onerror="window.pwned=1"><b>bold</b>';
  const page = await openPage(t, {
    runs: [doneRun()],
    detailsBody: {
      state: 'open',
      draft: false,
      conflicts: false,
      failing: [{ name: hostile, url: 'javascript:window.pwned=1' }],
      pending: [hostile],
      threads: [{ path: hostile, comment: hostile + '*x*'.repeat(500), url: 'javascript:window.pwned=1' }],
      threadsTotal: 1,
    },
  });
  if (!page) return;
  try {
    await check(page, 'd');
    assert.equal(
      await page.execute("return document.querySelectorAll('#detail .pr-details img, #detail .pr-details b').length"),
      0,
    );
    assert.equal(await page.execute("return document.querySelectorAll('#detail .pr-details a').length"), 0);
    assert.equal(await page.execute('return window.pwned === undefined'), true);
    assert.match(await drawer(page), /<img src=x/);
    assert.ok((await drawer(page)).length < 1200);
  } finally {
    await page.close();
  }
});
