import { test } from 'node:test';
import assert from 'node:assert/strict';
import { css } from './dashboard-files.js';
import { contrast, dark, light, systemDark } from './dashboard-tokens.js';

test('the token layer names its source and keeps the Fluent token names', () => {
  assert.match(css, /@fluentui\/tokens 1\.0\.0-alpha\.24/);
  assert.match(css, /webLightTheme/);
  assert.match(css, /webDarkTheme/);
  for (const name of ['colorNeutralBackground1', 'colorBrandBackground', 'fontSizeBase300', 'borderRadiusMedium', 'shadow4', 'durationFast']) assert.ok(light().has(name), name);
});

test('light, dark and system dark define the same tokens, and dark differs where Fluent says so', () => {
  const [l, d, s] = [light(), dark(), systemDark()];
  assert.ok(l.size >= 60, 'a real token layer, not a handful of colours');
  assert.deepEqual([...d.keys()].sort(), [...l.keys()].sort());
  assert.deepEqual([...s].sort(), [...d].sort(), 'the system dark theme is the dark theme');
  for (const name of ['colorNeutralBackground1', 'colorNeutralForeground1', 'colorBrandBackground', 'colorNeutralStroke1']) assert.notEqual(l.get(name), d.get(name), name);
  for (const name of ['borderRadiusMedium', 'fontSizeBase300', 'spacingHorizontalM']) assert.equal(l.get(name), d.get(name), name);
});

test('the Fluent values the Dashboard relies on are the ones the web themes publish', () => {
  const [l, d] = [light(), dark()];
  assert.equal(l.get('colorNeutralBackground1'), '#ffffff');
  assert.equal(d.get('colorNeutralBackground1'), '#292929');
  assert.equal(l.get('colorBrandBackground'), '#0f6cbd');
  assert.equal(l.get('fontSizeBase300'), '14px');
  assert.equal(l.get('borderRadiusMedium'), '4px');
  assert.match(l.get('fontFamilyBase'), /^'Segoe UI', .*sans-serif$/);
  assert.doesNotMatch(css, /@font-face/, 'no font is shipped');
});

// The rules of the stylesheet start after the token layer, at the universal box-sizing rule.
const rules = css.slice(css.indexOf('* { box-sizing: border-box; }'));

test('every token the rules use is defined, and every token the layer defines is used', () => {
  const used = new Set([...rules.matchAll(/var\(--(\w+)/g)].map((m) => m[1]));
  const defined = new Set(light().keys());
  assert.deepEqual([...used].filter((name) => !defined.has(name)), [], 'used but not defined');
  assert.deepEqual([...defined].filter((name) => !used.has(name)), [], 'defined but not used');
});

test('no rule uses a literal colour or a font family: the tokens carry them', () => {
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(rules, /\brgba?\(/);
  assert.doesNotMatch(rules, /\bhsla?\(/);
  assert.doesNotMatch(rules, /font-family:(?!\s*var\()/);
});

test('the old variable names are gone', () => {
  for (const old of ['--bg', '--panel', '--card', '--text', '--muted', '--border', '--btn-border', '--ok', '--flag', '--flag-bg', '--amber', '--primary', '--primary-text', '--header-bg', '--radius', '--shadow', '--focus', '--logo-ink']) {
    assert.doesNotMatch(css, new RegExp(`${old}\\b(?!\\w)`), old);
  }
});

// Text and background pairs the stylesheet draws (ADR 0025): [text token, background token]. Every pair needs 4.5:1 in both themes.
const SURFACES = ['colorNeutralBackground1', 'colorNeutralBackground2', 'colorNeutralBackground3'];
const TEXT_PAIRS = [
  ...['colorNeutralForeground1', 'colorNeutralForeground2', 'colorNeutralForeground3', 'colorBrandForegroundLink', 'colorBrandForegroundLinkHover', 'colorPaletteGreenForeground1', 'colorPaletteRedForeground1', 'colorStatusWarningForeground1'].flatMap((fg) => SURFACES.map((bg) => [fg, bg])),
  ...['colorNeutralForeground1', 'colorNeutralForeground3', 'colorPaletteRedForeground1', 'colorStatusWarningForeground1'].map((fg) => [fg, 'colorPaletteRedBackground1']),
  ['colorNeutralForeground1', 'colorNeutralBackground1Hover'],
  ['colorNeutralForeground1', 'colorNeutralBackground1Pressed'],
  ['colorPaletteGreenForeground1', 'colorPaletteGreenBackground1'],
  ['colorPaletteRedForeground1', 'colorPaletteRedBackground1'],
  ['colorNeutralForegroundOnBrand', 'colorBrandBackground'],
  ['colorNeutralForegroundOnBrand', 'colorBrandBackgroundHover'],
  ['colorNeutralForegroundOnBrand', 'colorBrandBackgroundPressed'],
  ['colorNeutralForegroundOnBrand', 'colorPaletteRedBackground3'],
];
// Non-text parts: control borders, focus rings and the progress fill need 3:1 against the surface they sit on.
const NON_TEXT_PAIRS = [
  ['colorNeutralStrokeAccessible', 'colorNeutralBackground1'], ['colorNeutralStrokeAccessible', 'colorNeutralBackground3'],
  ['colorStrokeFocus2', 'colorNeutralBackground1'], ['colorStrokeFocus2', 'colorNeutralBackground3'], ['colorStrokeFocus1', 'colorStrokeFocus2'],
  ['colorCompoundBrandBackground', 'colorNeutralBackground6'], ['colorCompoundBrandStroke', 'colorNeutralBackground1'],
  ['colorPaletteRedBorder2', 'colorPaletteRedBackground1'], ['colorPaletteRedBorder2', 'colorNeutralBackground1'], ['colorPaletteGreenBorder2', 'colorPaletteGreenBackground1'],
];

for (const [theme, tokens] of [['light', light], ['dark', dark]]) {
  test(`text and background pairs reach 4.5:1 in the ${theme} theme`, () => {
    const t = tokens();
    const low = TEXT_PAIRS.map(([fg, bg]) => [fg, bg, contrast(t.get(fg), t.get(bg))]).filter(([, , ratio]) => ratio < 4.5);
    assert.deepEqual(low.map(([fg, bg, ratio]) => `${fg} on ${bg}: ${ratio.toFixed(2)}`), []);
  });
  test(`borders, focus rings and the progress fill reach 3:1 in the ${theme} theme`, () => {
    const t = tokens();
    const low = NON_TEXT_PAIRS.map(([a, b]) => [a, b, contrast(t.get(a), t.get(b))]).filter(([, , ratio]) => ratio < 3);
    assert.deepEqual(low.map(([a, b, ratio]) => `${a} on ${b}: ${ratio.toFixed(2)}`), []);
  });
}

test('the contrast helper matches the WCAG reference values', () => {
  assert.equal(contrast('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48');
  assert.equal(contrast('#ffffff', '#ffffff').toFixed(2), '1.00');
});
