import { test } from 'node:test';
import assert from 'node:assert/strict';
import { css } from './dashboard-files.js';
import { dark, light, systemDark } from './dashboard-tokens.js';

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
