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
const fluent = (map) => new Map([...map].filter(([name]) => /^(color|border|stroke|font|line|spacing|shadow|duration|curve)/.test(name)));
export const light = () => fluent(tokensOf(section(':root {')));
export const dark = () => fluent(tokensOf(section(':root[data-theme="dark"] {')));
export const systemDark = () => fluent(tokensOf(section(':root:not([data-theme="light"]):not([data-theme="dark"]) {')));
