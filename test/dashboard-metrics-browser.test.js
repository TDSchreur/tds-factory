import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './browser.js';
import { interpretRun } from '../src/dashboard.js';

test('Run detail shows observed metrics and legacy no data', async (t) => {
  const entry = (id, record) => interpretRun({ id, record: { title: id, stage: 'build', status: 'running', ...record }, files: [] });
  const runs = [entry('measured', { track: 'fast', check_loops: 1, metrics: { version: 1, visits: [{ stage: 'define', started: '2026-01-01T00:00:00Z', ended: '2026-01-01T00:01:00Z' }], verdicts: [], first_check: 'unclean' } }), entry('legacy', {})];
  const page = await openPage(t, { runs });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=measured]')");
    await page.execute("document.querySelector('[data-id=measured]').click()");
    let text = await page.execute("return document.querySelector('[aria-label=\"Run metrics\"]').textContent");
    assert.match(text, /Track: Fast/);
    assert.match(await page.execute("return document.querySelector('[data-id=measured]').textContent"), /Fast/);
    assert.match(text, /Define: 1m 0s/); assert.match(text, /Reworks: 1/);
    assert.match(text, /First-pass clean rate: 0% \(0\/1\)/); assert.match(text, /Tokens: not tracked/); assert.match(text, /Cost: not tracked/);
    await page.execute("document.querySelector('[data-id=legacy]').click()");
    text = await page.execute("return document.querySelector('[aria-label=\"Run metrics\"]').textContent");
    assert.match(text, /Track: Full/);
    assert.match(text, /Define: no data/); assert.match(text, /First-pass clean rate: no data/);
  } finally { await page.close(); }
});
