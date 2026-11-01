import { css } from './dashboard-files.js';
import assert from 'node:assert/strict';

// The Fluent 2 token layer of dashboard/style.css (ADR 0025): the same tokens for light, dark and system dark.
const section = (start) => {
  const i = css.indexOf(start);
  assert.notEqual(i, -1, start);
  let depth = 0;
  for (let j = css.indexOf('{', i); j < css.length; j++) {
    if (css[j] === '{') depth++;
    if (css[j] === '}' && --depth === 0) return css.slice(css.indexOf('{', i) + 1, j);
  }
  throw new Error('unclosed ' + start);
};
const tokensOf = (body) => new Map([...body.matchAll(/--(\w+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const fluent = (map) =>
  new Map([...map].filter(([name]) => /^(color|border|stroke|font|line|spacing|shadow|duration|curve)/.test(name)));
export const light = () => fluent(tokensOf(section(':root {')));
export const dark = () => fluent(tokensOf(section(':root[data-theme="dark"] {')));
export const systemDark = () => fluent(tokensOf(section(':root:not([data-theme="light"]):not([data-theme="dark"]) {')));

// WCAG 2.x contrast ratio of two #rrggbb colours.
const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
