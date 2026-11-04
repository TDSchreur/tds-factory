import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withPollMs } from './poll-interval.js';

const MODEL = readFileSync(new URL('../dashboard/model.js', import.meta.url), 'utf8');

test('withPollMs sets the poll interval and keeps the rest of the file byte for byte', () => {
  const changed = withPollMs(MODEL, 100);
  assert.match(changed, /^export const POLL_MS = 100;$/m);
  assert.equal(changed.replace('POLL_MS = 100;', 'POLL_MS = 2000;'), MODEL);
});

test('withPollMs on the real constants file finds the constant the Dashboard ships', () => {
  assert.doesNotThrow(() => withPollMs(MODEL, 50));
});

test('withPollMs fails and names the file and the line when the constant is missing', () => {
  assert.throws(
    () => withPollMs('export const STALE_MS = 1;\n', 100),
    /dashboard\/model\.js.*export const POLL_MS = <number>;/,
  );
});

test('withPollMs fails when the constant appears twice', () => {
  const twice = 'export const POLL_MS = 2000;\nexport const POLL_MS = 3000;\n';
  assert.throws(() => withPollMs(twice, 100), /exactly once/);
});

test('withPollMs refuses an interval that is not a positive whole number of milliseconds', () => {
  for (const bad of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => withPollMs(MODEL, bad), /positive whole number/, String(bad));
  }
});
