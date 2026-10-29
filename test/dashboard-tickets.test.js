import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ticketsOf } from '../dashboard/model.js';
import { interpretRun } from '../src/dashboard.js';

test('the card lists Tickets with done, active and todo states', () => {
  const run = { column: 'build', ticketsDone: 1, tickets: ['https://github.com/o/r/issues/110', 'https://github.com/o/r/issues/111', 'docs/tickets/3-x.md'] };
  assert.deepEqual(ticketsOf(run).map((t) => [t.label, t.state]), [['#110', 'done'], ['#111', 'active'], ['3-x.md', 'todo']]);
  assert.equal(ticketsOf({ ...run, column: 'check', ticketsDone: 3 }).every((t) => t.state === 'done'), true);
});

test('interpretRun passes the Ticket links to the page', () => {
  const r = interpretRun({ id: 'a', record: { status: 'running', stage: 'build', tickets: ['u1', 7, 'u2'] } });
  assert.deepEqual(r.tickets, ['u1', 'u2']);
});

test('interpretRun exposes pause reasons without treating them as human waiting', () => {
  for (const status of ['interrupted', 'verification-unavailable']) {
    const view = interpretRun({ id: 'a', record: { status, status_reason: 'blocked', waiting_on_human: false } });
    assert.equal(view.reason, 'blocked');
    assert.equal(view.waiting, false);
  }
});
