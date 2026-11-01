import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';
import { prStatusOf } from '../dashboard/model.js';

const AZ = 'https://dev.azure.com/o/p/_git/r/pullrequest/1';
const open = (over = {}) => ({ state: 'open', draft: false, checks: { result: 'passing', failing: [] }, merge: 'mergeable', review: 'approved', ...over });
const azure = (over) => run({ pr: AZ, prHost: 'azure-devops', prCanMerge: false, ...over });
const text = (page, selector) => page.execute(`const e = document.querySelector(${JSON.stringify(selector)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null`);

test('the unavailable texts of Azure DevOps name the fix and the host', () => {
  const reason = (unavailable, prHost) => prStatusOf({ prHost, prStatus: { unavailable } }).text;
  assert.match(reason('az-missing', 'azure-devops'), /az command is not installed/);
  assert.match(reason('az-extension-missing', 'azure-devops'), /az extension add --name azure-devops/);
  assert.match(reason('az-not-signed-in', 'azure-devops'), /az login/);
  assert.equal(reason('rate-limited', 'azure-devops'), 'Azure DevOps rate limit reached');
  assert.equal(reason('error', 'azure-devops'), 'Azure DevOps could not be read');
  assert.equal(reason('rate-limited', 'github'), 'GitHub rate limit reached');
  assert.equal(reason('error', undefined), 'GitHub could not be read');
  assert.match(reason('not-signed-in', 'github'), /gh auth login/);
});

test('an Azure DevOps pull request shows its status, the unavailable fixes and no Merge button', async (t) => {
  const runs = [
    azure({ id: 'a', title: 'Open', column: 'finish', prStatus: open({ checks: { result: 'failing', failing: ['Comment requirements'] }, merge: 'conflicting', review: 'required' }) }),
    azure({ id: 'b', title: 'No extension', column: 'finish', prStatus: { unavailable: 'az-extension-missing' } }),
    azure({ id: 'c', title: 'Ready', column: 'done', status: 'done', prState: 'open', prStatus: open() }),
    run({ id: 'g', title: 'GitHub ready', column: 'done', status: 'done', pr: 'https://github.com/o/r/pull/1', prHost: 'github', prCanMerge: true, prState: 'open' }),
  ];
  const page = await openPage(t, { runs });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=a]')");
    assert.equal(await text(page, '[data-id=a] .pr-status'), 'Pull request Checks: failing: Comment requirements Merge: conflicts with the base branch Review: review required');
    assert.equal(await text(page, '[data-id=b] .pr-status'), 'Pull request PR status unavailable: the Azure DevOps extension is missing (run az extension add --name azure-devops) Check again');
    assert.equal(await page.execute("return document.querySelector('[data-id=c] .actions .primary')"), null, 'no Merge button on an Azure DevOps pull request');
    assert.equal(await text(page, '[data-id=c] .merge-note'), 'Merge it in Azure DevOps');
    assert.equal(await text(page, '[data-id=g] .actions .primary'), 'Merge', 'GitHub keeps its Merge button');
    assert.equal(await page.execute("return document.querySelector('[data-id=g] .merge-note')"), null);
  } finally { await page.close(); }
});
