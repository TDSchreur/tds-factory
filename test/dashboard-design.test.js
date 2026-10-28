import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];

test('design tokens are defined for light and dark themes', () => {
  for (const token of ['--bg', '--card', '--text', '--muted', '--border', '--primary', '--radius', '--shadow']) {
    assert.match(css, new RegExp(`${token}:`), `${token} is defined`);
  }
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /prefers-color-scheme: dark/);
});

test('header is sticky and keeps the safe controls', () => {
  assert.match(css, /header\s*\{[^}]*position:\s*sticky/);
  for (const id of ['theme', 'older', 'status', 'project']) assert.match(html, new RegExp(`id="${id}"`));
});

test('board stacks on narrow screens', () => {
  assert.match(css, /@media \(max-width: \d+(\.\d+)?(rem|px)\)[\s\S]*#board[\s\S]*grid-template-columns:\s*1fr/);
});

test('interactive elements have visible focus styles and no external resources', () => {
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:/);
  assert.doesNotMatch(css, /@import|url\(https?:/);
});
