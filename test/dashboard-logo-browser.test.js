import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';

const logoBox = "const r = document.querySelector('header h1 svg').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]";
const inkColour = "return getComputedStyle(document.querySelector('header h1 svg .ink')).fill";

test('the top bar shows the logo and the heading keeps its text', async (t) => {
  const page = await openPage(t, { runs: [run()] });
  if (!page) return;
  try {
    const [width, height] = await page.execute(logoBox);
    assert.ok(height >= 28 && width > height, `logo ${width}x${height}`);
    assert.equal(await page.execute("return document.querySelector('header h1').textContent"), 'tds-factory');
  } finally { await page.close(); }
});

test('the dark parts of the logo change colour with the theme', async (t) => {
  const page = await openPage(t, { runs: [run()] });
  if (!page) return;
  try {
    await page.execute("document.documentElement.dataset.theme = 'light'");
    const light = await page.execute(inkColour);
    await page.execute("document.documentElement.dataset.theme = 'dark'");
    assert.notEqual(await page.execute(inkColour), light);
  } finally { await page.close(); }
});

test('on a phone the logo and tagline sit inside the viewport and the page does not scroll sideways', async (t) => {
  const page = await openPage(t, { runs: [run()] }, { width: 375 });
  if (!page) return;
  try {
    assert.ok((await page.execute(logoBox))[1] > 0);
    assert.equal(await page.execute("return document.querySelector('header .tagline').getBoundingClientRect().right <= document.documentElement.clientWidth"), true);
    assert.equal(await page.execute("return document.documentElement.scrollWidth <= document.documentElement.clientWidth"), true);
  } finally { await page.close(); }
});
