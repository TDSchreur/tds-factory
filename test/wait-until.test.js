import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitUntil } from './wait-until.js';

test('waitUntil resolves with the first truthy value', async () => {
  let calls = 0;
  const value = await waitUntil(() => (++calls >= 3 ? 'ready' : ''), { intervalMs: 1 });
  assert.equal(value, 'ready');
  assert.equal(calls, 3);
});

test('waitUntil accepts an async condition', async () => {
  let calls = 0;
  assert.equal(await waitUntil(async () => ++calls >= 2 && 42, { intervalMs: 1 }), 42);
});

test('waitUntil rejects with the message when the deadline passes', async () => {
  await assert.rejects(
    waitUntil(() => false, { timeoutMs: 30, intervalMs: 1, message: 'never ready' }),
    /never ready/,
  );
});

test('waitUntil checks once more at the deadline', async () => {
  const start = Date.now();
  assert.equal(await waitUntil(() => Date.now() - start >= 20, { timeoutMs: 20, intervalMs: 50 }), true);
});
