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
  for (const bad of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '100', null, undefined]) {
    assert.throws(() => withPollMs(MODEL, /** @type {number} */ (bad)), /positive whole number/, String(bad));
  }
});

test('withPollMs keeps Windows line endings', () => {
  const crlf = 'export const A = 1;\r\nexport const POLL_MS = 2000;\r\nexport const B = 2;\r\n';
  assert.equal(withPollMs(crlf, 100), 'export const A = 1;\r\nexport const POLL_MS = 100;\r\nexport const B = 2;\r\n');
});

test('withPollMs ignores lines that only look like the constant', () => {
  const decoys = [
    '  export const POLL_MS = 1;',
    '// export const POLL_MS = 1;',
    'export const POLL_MS_OTHER = 1;',
    'export const POLL_MS = 1000 * 2;',
    'const POLL_MS = 1;',
  ].join('\n');
  assert.throws(() => withPollMs(decoys, 100), /holds it 0 times/);
  const real = decoys + '\nexport const POLL_MS = 2000;\n';
  assert.equal(withPollMs(real, 100), decoys + '\nexport const POLL_MS = 100;\n');
});

test('withPollMs on a very large file with many look-alike lines still finishes, with a generous bound', () => {
  const filler = 'export const POLL_MS_X = 1;\n'.repeat(50_000) + 'x'.repeat(1_000_000) + '\n';
  const started = Date.now();
  const changed = withPollMs(filler + 'export const POLL_MS = 2000;\n', 100);
  assert.ok(changed.endsWith('export const POLL_MS = 100;\n'));
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
});
