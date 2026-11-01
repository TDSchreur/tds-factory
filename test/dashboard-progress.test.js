import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUIET_MS, lastSeenOf, modelOf, progressOf, timelineOf } from '../dashboard/model.js';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const minutesAgo = (m) => new Date(NOW - m * 60000).toISOString();

test('progressOf gives done and total only for a positive total', () => {
  assert.deepEqual(progressOf({ ticketsDone: 1, ticketsTotal: 3 }), { done: 1, total: 3 });
  assert.deepEqual(progressOf({ ticketsDone: 9, ticketsTotal: 3 }), { done: 3, total: 3 });
  assert.deepEqual(progressOf({ ticketsTotal: 2 }), { done: 0, total: 2 });
  assert.equal(progressOf({ ticketsTotal: 0 }), null);
  assert.equal(progressOf({ ticketsDone: 'x', ticketsTotal: 'y' }), null);
  assert.equal(progressOf({}), null);
});

test('modelOf labels a request as requested and only a report as observed', () => {
  assert.deepEqual(modelOf({ model: { requested: 'sonnet', effort: 'high', observed: '' } }), {
    label: 'Model (requested): sonnet, effort high',
    observed: false,
  });
  assert.deepEqual(modelOf({ model: { requested: 'sonnet', effort: '', observed: 'haiku' } }), {
    label: 'Model (observed): haiku',
    observed: true,
    title: 'Requested: sonnet',
  });
  assert.deepEqual(modelOf({ model: { requested: '', effort: 'low', observed: '' } }), {
    label: 'Effort (requested): low',
    observed: false,
  });
  assert.equal(modelOf({ model: { requested: '', effort: '', observed: '' } }), null);
  assert.equal(modelOf({}), null);
  assert.equal(modelOf({ model: 'sonnet' }), null);
});

test('lastSeenOf warns after ten minutes, only while running', () => {
  assert.equal(QUIET_MS, 10 * 60 * 1000);
  const run = (status, seen, extra = {}) => ({ status, lastSeen: seen, ...extra });
  assert.deepEqual(lastSeenOf(run('running', minutesAgo(3)), NOW), { text: 'Last seen 3 min ago', quiet: false });
  assert.deepEqual(lastSeenOf(run('running', minutesAgo(10)), NOW), {
    text: 'Last seen 10 min ago, quiet',
    quiet: true,
  });
  assert.equal(lastSeenOf(run('waiting', minutesAgo(30)), NOW).quiet, false);
  assert.equal(lastSeenOf(run('done', minutesAgo(30)), NOW), null);
  assert.equal(lastSeenOf(run('abandoned', minutesAgo(30)), NOW), null);
  assert.equal(lastSeenOf(run('running', '', { updated: minutesAgo(12) }), NOW), null);
  assert.equal(lastSeenOf(run('running', 'nonsense'), NOW), null);
  assert.equal(lastSeenOf({ unreadable: true, lastSeen: minutesAgo(1) }, NOW), null);
});

test('timelineOf describes known events and tolerates bad ones', () => {
  const events = [
    { type: 'stage', at: minutesAgo(30), from: 'define', to: 'build' },
    { type: 'ticket-done', at: minutesAgo(25), done: 2, total: 3 },
    { type: 'verify-start', at: minutesAgo(20), fast: true },
    { type: 'verify', at: minutesAgo(19), fast: false, exit_code: 0, duration_ms: 12000 },
    { type: 'verify', at: minutesAgo(18), fast: true, exit_code: 1, duration_ms: 90000 },
    { type: 'waiting', at: minutesAgo(10), reason: 'Question' },
    { type: 'released', at: minutesAgo(8) },
    { type: 'rework', at: minutesAgo(5), loops: 2 },
    { type: 'status', at: minutesAgo(4), status: 'interrupted' },
    { type: 'mystery', at: minutesAgo(2) },
    { type: 'stage' },
    null,
  ];
  const lines = timelineOf({ events }, NOW).map((e) => e.text);
  assert.deepEqual(lines, [
    'Moved from define to build',
    'Ticket 2 of 3 done',
    'Fast Verify started',
    'Verify passed in 12s',
    'Fast Verify failed in 1m 30s',
    'Waiting: Question',
    'Released',
    'Rework, loop 2',
    'Status: interrupted',
    'mystery',
    'stage',
  ]);
  assert.equal(timelineOf({ events }, NOW)[0].when, '30 min ago');
  assert.equal(timelineOf({ events }, NOW).at(-1).when, '');
  assert.deepEqual(timelineOf({}, NOW), []);
  assert.deepEqual(timelineOf({ events: 'x' }, NOW), []);
});
