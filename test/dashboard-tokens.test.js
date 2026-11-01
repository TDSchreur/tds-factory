import { test } from 'node:test';
import assert from 'node:assert/strict';
import { css } from './dashboard-files.js';
import { dark, light, systemDark } from './dashboard-tokens.js';

test('the token layer names its source and keeps the Fluent token names', () => {
  assert.match(css, /@fluentui\/tokens 1\.0\.0-alpha\.24/);
  assert.match(css, /webLightTheme/);
  assert.match(css, /webDarkTheme/);
  for (const name of ['colorNeutralBackground1', 'colorBrandBackground', 'fontSizeBase300', 'borderRadiusMedium', 'shadow4', 'durationNormal']) assert.ok(light().has(name), name);
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
