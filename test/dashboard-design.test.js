import { test } from 'node:test';
import assert from 'node:assert/strict';
import { index, css } from './dashboard-files.js';

const html = index;

test('design tokens are defined for light and dark themes', () => {
  for (const token of [
    '--colorNeutralBackground1',
    '--colorNeutralBackground2',
    '--colorNeutralForeground1',
    '--colorNeutralForeground3',
    '--colorNeutralStroke1',
    '--colorBrandBackground',
    '--borderRadiusMedium',
    '--shadow4',
  ]) {
    assert.match(css, new RegExp(`${token}:`), `${token} is defined`);
  }
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /prefers-color-scheme: dark/);
});

test('header is sticky', () => {
  assert.match(css, /header\s*\{[^}]*position:\s*sticky/);
});

test('board stacks on narrow screens', () => {
  assert.match(css, /@media \(max-width: \d+(\.\d+)?(rem|px)\)[\s\S]*#board[\s\S]*grid-template-columns:\s*1fr/);
});

test('interactive elements have visible focus styles and no external resources', () => {
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:/);
  assert.doesNotMatch(css, /@import|url\(https?:/);
});
