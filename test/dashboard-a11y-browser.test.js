import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, run } from './browser.js';
import { contrast } from './dashboard-tokens.js';

const runs = () => [
  run({
    id: 'w',
    title: 'Waiting',
    column: 'check',
    status: 'waiting',
    waiting: true,
    reason: 'Blocking findings remain',
    loops: 4,
    loopCap: 4,
    standards: 'pass',
    spec: 'pass',
    security: 'fail',
    infrastructure: 'skipped',
    ticketsDone: 1,
    ticketsTotal: 3,
    activity: 'Check: waiting',
    lastSeen: new Date(Date.now() - 14 * 60000).toISOString(),
    model: { requested: 'sonnet', effort: '', observed: '' },
    pr: 'https://github.com/o/r/pull/1',
    prStatus: {
      state: 'open',
      draft: false,
      checks: { result: 'failing', failing: ['Tests'] },
      merge: 'conflicting',
      review: 'none',
    },
  }),
  run({
    id: 'b',
    title: 'Building',
    column: 'build',
    ticketsDone: 1,
    ticketsTotal: 2,
    tickets: ['https://github.com/o/r/issues/1', 'https://github.com/o/r/issues/2'],
    updated: new Date(Date.now() - 20 * 60000).toISOString(),
  }),
  run({
    id: 'd',
    title: 'Done',
    column: 'done',
    status: 'done',
    pr: 'https://github.com/o/r/pull/2',
    prState: 'merged',
    standards: 'pass',
    spec: 'pass',
    security: 'pass',
    infrastructure: 'skipped',
  }),
  run({
    id: 'x',
    title: 'Abandoned',
    column: 'done',
    status: 'abandoned',
    pr: 'https://github.com/o/r/pull/3',
    prState: 'closed',
    standards: 'pass',
    spec: 'fail',
    security: 'skipped',
    infrastructure: 'skipped',
    ticketsDone: 1,
    ticketsTotal: 2,
    activity: 'Stopped by the user',
  }),
  run({
    id: 'm',
    title: 'Mergeable',
    column: 'done',
    status: 'done',
    pr: 'https://github.com/o/r/pull/4',
    prState: 'open',
    standards: 'pass',
    spec: 'pass',
    security: 'pass',
    infrastructure: 'skipped',
  }),
];

// Switches the transitions off for a test that reads colours or shadows, and waits until that has taken effect:
// a transition that has just started still reads its old value, and the emulation reaches the page a moment after the command.
const calm = async (page, extra = []) => {
  await page.cdp('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, ...extra],
  });
  await page.waitFor(
    "return matchMedia('(prefers-reduced-motion: reduce)').matches && getComputedStyle(document.querySelector('button')).transitionDuration === '0s'",
  );
};

// Forces :hover, :active or :focus-visible on the first element that matches the selector, as a pointer or the keyboard would.
const force = async (page, selector, states) => {
  await page.cdp('DOM.enable', {});
  await page.cdp('CSS.enable', {});
  const { root } = await page.cdp('DOM.getDocument', {});
  const { nodeId } = await page.cdp('DOM.querySelector', { nodeId: root.nodeId, selector });
  assert.ok(nodeId, selector);
  await page.cdp('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states });
};

// Every visible text node, with its colour and the first opaque background behind it, as [selector hint, colour, background, font size].
const SAMPLE = `
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const behind = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; } return parse(getComputedStyle(document.body).backgroundColor); };
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || !el || !el.getClientRects().length || el.closest('[hidden], script, style, .sr, option')) continue;
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.opacity === '0') continue;
    let fg = parse(s.color), bg = behind(el);
    // An element that is faded (opacity) blends its text and its background with what is behind the faded element.
    let alpha = 1, top = null;
    for (let e = el; e; e = e.parentElement) { const o = Number(getComputedStyle(e).opacity); if (o < 1) { alpha *= o; top = e; } }
    if (top) { const under = behind(top.parentElement); const mix = (c) => ({ r: c.r * alpha + under.r * (1 - alpha), g: c.g * alpha + under.g * (1 - alpha), b: c.b * alpha + under.b * (1 - alpha) }); fg = mix(fg); bg = mix(bg); }
    out.push([el.className || el.tagName.toLowerCase(), [fg.r, fg.g, fg.b], [bg.r, bg.g, bg.b], n.textContent.trim().slice(0, 30)]);
  }
  return out;`;
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

for (const theme of ['light', 'dark']) {
  test(`the rendered text keeps 4.5:1 against its background in the ${theme} theme`, async (t) => {
    const page = await openPage(t, { runs: runs() });
    if (!page) return;
    try {
      await calm(page);
      await page.waitFor("return !!document.querySelector('[data-id=w]')");
      await page.execute(`document.documentElement.dataset.theme = '${theme}'`);
      assert.ok(
        await page.execute("return !!document.querySelector('[data-id=x].abandoned')"),
        'the sample holds an abandoned card',
      );
      await page.execute("document.querySelector('[data-id=w]').click()");
      await page.waitFor("return !!document.querySelector('#detail .reason')");
      const samples = await page.execute(SAMPLE);
      assert.ok(samples.length > 40, `many text nodes were sampled (${samples.length})`);
      const low = samples
        .map(([cls, fg, bg, text]) => [cls, text, contrast(hex(fg), hex(bg))])
        .filter(([, , ratio]) => ratio < 4.5);
      assert.ok(
        samples.some(([, , , text]) => text === 'Abandoned'),
        'the abandoned card title was sampled',
      );
      assert.deepEqual(
        low.map(([cls, text, ratio]) => `${cls} "${text}": ${ratio.toFixed(2)}`),
        [],
      );
    } finally {
      await page.close();
    }
  });
}

for (const theme of ['light', 'dark']) {
  test(`the help panel and the welcome card keep 4.5:1 text contrast in the ${theme} theme`, async (t) => {
    const state = { runs: [] };
    const page = await openPage(t, state);
    if (!page) return;
    try {
      await calm(page);
      await page.waitFor("return !!document.querySelector('.welcome')");
      await page.execute(`document.documentElement.dataset.theme = '${theme}'`);
      const welcome = await page.execute(SAMPLE);
      assert.ok(
        welcome.some(([, , , text]) => text === 'No Runs yet'),
        'the welcome card was sampled',
      );
      await page.execute("document.getElementById('help').click()");
      await page.waitFor("return document.getElementById('help-panel').open");
      const panel = await page.execute(SAMPLE);
      assert.ok(
        panel.some(([, , , text]) => text === 'Help'),
        'the help panel was sampled',
      );
      const low = [...welcome, ...panel]
        .map(([cls, fg, bg, text]) => [cls, text, contrast(hex(fg), hex(bg))])
        .filter(([, , ratio]) => ratio < 4.5);
      assert.deepEqual(
        low.map(([cls, text, ratio]) => `${cls} "${text}": ${ratio.toFixed(2)}`),
        [],
      );
    } finally {
      await page.close();
    }
  });
}

test('every control shows a focus ring in two colours that do not depend on the theme', async (t) => {
  const page = await openPage(t, { runs: runs() });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=w]')");
    for (const theme of ['light', 'dark']) {
      await page.execute(`document.documentElement.dataset.theme = '${theme}'`);
      await page.key(''); // Tab
      const ring = await page.execute(
        'const s = getComputedStyle(document.activeElement); return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, document.activeElement.tagName]',
      );
      assert.equal(ring[0], 'solid', theme + ' ' + ring[4]);
      assert.equal(ring[1], '2px');
      assert.notEqual(ring[2], 'rgba(0, 0, 0, 0)');
      assert.match(ring[3], /0px 0px 0px 2px/, 'an inner ring');
      assert.notEqual(ring[3], 'none');
    }
  } finally {
    await page.close();
  }
});

test('reduced motion switches the transitions off', async (t) => {
  const page = await openPage(t, { runs: runs() });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=w]')");
    const duration = () =>
      page.execute(
        "return [getComputedStyle(document.querySelector('.card')).transitionDuration, getComputedStyle(document.querySelector('button')).transitionDuration]",
      );
    assert.ok(
      (await duration()).every((value) => value !== '0s'),
      'transitions run by default',
    );
    await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await page.execute("return matchMedia('(prefers-reduced-motion: reduce)').matches"), true);
    assert.deepEqual(await duration(), ['0s', '0s']);
  } finally {
    await page.close();
  }
});

test('forced colours draw the state markers in system colours', async (t) => {
  const page = await openPage(t, { runs: runs() });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=b] .progress-fill')");
    await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    assert.equal(await page.execute("return matchMedia('(forced-colors: active)').matches"), true);
    const colours = await page.execute(`
      const probe = (value) => { const p = document.createElement('i'); p.style.color = value; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
      const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
      return { highlight: probe('Highlight'), canvasText: probe('CanvasText'), fill: bg('[data-id=b] .progress-fill'), dot: getComputedStyle(document.getElementById('status'), '::before').backgroundColor, track: getComputedStyle(document.querySelector('.progress')).borderTopColor, border: getComputedStyle(document.querySelector('.progress')).borderTopWidth, waiting: getComputedStyle(document.querySelector('.card.waiting')).borderTopStyle };`);
    assert.equal(colours.fill, colours.highlight, 'the progress fill is the system highlight');
    assert.equal(colours.dot, colours.highlight, 'the status dot is the system highlight');
    assert.equal(colours.track, colours.canvasText);
    assert.equal(colours.border, '1px');
    assert.equal(colours.waiting, 'double', 'a waiting card is also marked by its border style');
    const waiting = await page.execute(
      "const s = getComputedStyle(document.querySelector('.card.waiting')); return [s.borderTopStyle, s.borderTopWidth]",
    );
    assert.deepEqual(waiting, ['double', '3px'], 'a double border needs at least 3px to show two lines');
  } finally {
    await page.close();
  }
});

test('forced colours keep the button colours of the primary and pressed buttons when hovered or pressed', async (t) => {
  const page = await openPage(t, { runs: runs() });
  if (!page) return;
  try {
    await page.waitFor("return !!document.querySelector('[data-id=m] .primary')");
    await calm(page, [{ name: 'forced-colors', value: 'active' }]);
    const read = (selector) =>
      page.execute(`
      const probe = (value) => { const p = document.createElement('i'); p.style.color = value; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
      const s = getComputedStyle(document.querySelector(${JSON.stringify(selector)}));
      return { background: s.backgroundColor, colour: s.color, highlight: probe('Highlight'), highlightText: probe('HighlightText') };`);
    const check = async (selector) => {
      for (const states of [[], ['hover'], ['hover', 'active']]) {
        await force(page, selector, states);
        const seen = await read(selector);
        assert.equal(
          seen.background,
          seen.highlight,
          `${selector} ${states.join('+') || 'rest'}: the background is the system highlight`,
        );
        assert.equal(
          seen.colour,
          seen.highlightText,
          `${selector} ${states.join('+') || 'rest'}: the text is the system highlight text`,
        );
      }
    };
    await check('[data-id=m] .primary');
    await page.execute("document.getElementById('needs-you').click()");
    await page.waitFor("return document.getElementById('needs-you').getAttribute('aria-pressed') === 'true'");
    await check('#needs-you');
  } finally {
    await page.close();
  }
});

test('a hovered or selected card keeps its inner focus ring', async (t) => {
  const page = await openPage(t, { runs: runs() });
  if (!page) return;
  try {
    await calm(page);
    await page.waitFor("return !!document.querySelector('[data-id=b]')");
    const ring = () =>
      page.execute(`
      const p = document.createElement('i'); p.style.color = 'var(--colorStrokeFocus1)'; document.body.append(p); const focus = getComputedStyle(p).color; p.remove();
      return { focus, shadow: getComputedStyle(document.querySelector('[data-id=b]')).boxShadow };`);
    await page.execute("document.querySelector('[data-id=b]').focus()");
    assert.equal(
      await page.execute("return document.querySelector('[data-id=b]').matches(':focus-visible')"),
      true,
      'the card is focused as the keyboard would',
    );
    let seen = await ring();
    assert.ok(seen.shadow.includes(seen.focus + ' 0px 0px 0px 2px'), 'focused: ' + seen.shadow);
    await force(page, '[data-id=b]', ['hover']);
    seen = await ring();
    assert.ok(seen.shadow.includes(seen.focus + ' 0px 0px 0px 2px'), 'focused and hovered: ' + seen.shadow);
    await page.execute("document.querySelector('[data-id=b]').click()");
    await page.waitFor("return document.querySelector('[data-id=b]').classList.contains('selected')");
    await page.waitFor("return document.activeElement === document.querySelector('#detail h2')"); // opening the detail takes the focus after the next frame; only then is the card ours to focus
    await page.execute("document.querySelector('[data-id=b]').focus()");
    assert.equal(
      await page.execute("return document.querySelector('[data-id=b]').matches('.selected:focus-visible')"),
      true,
      'the selected card is focused as the keyboard would',
    );
    seen = await ring();
    assert.ok(seen.shadow.includes(seen.focus + ' 0px 0px 0px 2px'), 'focused and selected: ' + seen.shadow);
  } finally {
    await page.close();
  }
});
