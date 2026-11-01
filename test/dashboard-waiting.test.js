import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortWaitingFirst, waitAgeOf, waitingSince } from '../dashboard/model.js';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const at = (m) => new Date(NOW - m * 60000).toISOString();

test('waitingSince is the latest waiting event that nothing released', () => {
  assert.equal(waitingSince({ events: [{ type: 'waiting', at: at(30) }, { type: 'released', at: at(20) }, { type: 'waiting', at: at(10) }] }), NOW - 10 * 60000);
  assert.equal(waitingSince({ events: [{ type: 'waiting', at: at(30) }, { type: 'ticket-done', at: at(5) }] }), NOW - 30 * 60000);
  assert.equal(waitingSince({ events: [{ type: 'waiting', at: at(30) }, { type: 'released', at: at(20) }] }), null);
  assert.equal(waitingSince({ events: [{ type: 'waiting', at: at(30) }, { type: 'status', status: 'interrupted', at: at(20) }] }), null);
  assert.equal(waitingSince({ events: [{ type: 'waiting', at: 'nonsense' }] }), null);
  assert.equal(waitingSince({ events: [] }), null);
  assert.equal(waitingSince({ events: 'x' }), null);
  assert.equal(waitingSince({ events: [null, 7, { type: 'waiting', at: at(2) }] }), NOW - 2 * 60000);
  assert.equal(waitingSince({}), null);
});

test('waitAgeOf names the wait only for a waiting Run with a known start', () => {
  const run = (minutes, extra = {}) => ({ waiting: true, events: [{ type: 'waiting', at: at(minutes) }], ...extra });
  assert.deepEqual(waitAgeOf(run(12), NOW), { text: 'waiting 12 min' });
  assert.deepEqual(waitAgeOf(run(0), NOW), { text: 'waiting less than a minute' });
  assert.deepEqual(waitAgeOf(run(180), NOW), { text: 'waiting 3 h' });
  assert.deepEqual(waitAgeOf(run(3000), NOW), { text: 'waiting 2 d' });
  assert.equal(waitAgeOf(run(12, { waiting: false }), NOW), null);
  assert.equal(waitAgeOf({ waiting: true, events: [] }, NOW), null);
  assert.equal(waitAgeOf({ waiting: true }, NOW), null);
});

test('sortWaitingFirst puts the longest waiting Run first and keeps the rest in order', () => {
  const w = (id, minutes) => ({ id, waiting: true, events: minutes === null ? [] : [{ type: 'waiting', at: at(minutes) }] });
  const n = (id) => ({ id, waiting: false });
  const sorted = sortWaitingFirst([n('a'), w('short', 5), n('b'), w('unknown', null), w('long', 50), n('c')]);
  assert.deepEqual(sorted.map((r) => r.id), ['long', 'short', 'unknown', 'a', 'b', 'c']);
  assert.deepEqual(sortWaitingFirst([]), []);
  const input = [n('x'), w('y', 1)];
  sortWaitingFirst(input);
  assert.deepEqual(input.map((r) => r.id), ['x', 'y']);
});
