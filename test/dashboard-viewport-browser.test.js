import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from './browser.js';

for (const width of [320, 375, 390, 768, 1024, 1200]) {
  test(`browser fixture provides an exact ${width} by 700 CSS pixel viewport`, async (t) => {
    const page = await openPage(t, {}, { width, height: 700 });
    if (!page) return;
    try {
      assert.deepEqual(await page.execute('return [window.innerWidth, window.innerHeight]'), [width, 700]);
    } finally { await page.close(); }
  });
}
