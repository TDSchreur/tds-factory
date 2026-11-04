import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentLabel, folderName, ticketsOf } from '../dashboard/model.js';
import { interpretRun } from '../src/dashboard.js';
import { entryOf, runView } from './run-view.js';

test('the card lists Tickets with done, active and todo states', () => {
  const run = runView({
    column: 'build',
    ticketsDone: 1,
    tickets: ['https://github.com/o/r/issues/110', 'https://github.com/o/r/issues/111', 'docs/tickets/3-x.md'],
  });
  assert.deepEqual(
    ticketsOf(run).map((t) => [t.label, t.state]),
    [
      ['#110', 'done'],
      ['#111', 'active'],
      ['3-x.md', 'todo'],
    ],
  );
  assert.equal(
    ticketsOf({ ...run, column: 'check', ticketsDone: 3 }).every((t) => t.state === 'done'),
    true,
  );
});

test('interpretRun passes the Ticket links to the page', () => {
  const r = interpretRun(entryOf('a', { status: 'running', stage: 'build', tickets: ['u1', 7, 'u2'] }));
  assert.deepEqual(r.tickets, ['u1', 'u2']);
});

test('interpretRun exposes pause reasons without treating them as human waiting', () => {
  for (const status of ['interrupted', 'verification-unavailable']) {
    const view = interpretRun(entryOf('a', { status, status_reason: 'blocked', waiting_on_human: false }));
    assert.equal(view.reason, 'blocked');
    assert.equal(view.waiting, false);
  }
});

test('folderName keeps the last path segment for either separator and tolerates a trailing one', () => {
  assert.equal(folderName('/work/tds-factory/'), 'tds-factory');
  assert.equal(folderName('C:\\work\\tds-factory'), 'tds-factory');
  assert.equal(folderName(''), '');
});

test('a Ticket with a title in the Run view data is labelled with it, and a remote or untitled link keeps its label', () => {
  const run = runView({
    tickets: ['.scratch/f/issues/01-a.md', '.scratch/f/issues/02-b.md', 'https://github.com/o/r/issues/7', 'toString'],
    titles: {
      '.scratch/f/issues/01-a.md': '01 Skeleton and gh wrapper',
      'https://github.com/o/r/issues/7': 'Should never show',
    },
  });
  assert.deepEqual(
    ticketsOf(run).map((t) => t.label),
    ['01 Skeleton and gh wrapper', '02-b.md', '#7', 'toString'],
  );
});

test('documentLabel falls back to the file name without titles', () => {
  assert.equal(documentLabel(runView(), 'docs/specs/x.md'), 'x.md');
  assert.equal(documentLabel(runView({ titles: { 'docs/specs/x.md': '' } }), 'docs/specs/x.md'), 'x.md');
  assert.equal(documentLabel(runView({ titles: { 'docs/specs/x.md': 'The Spec' } }), 'docs/specs/x.md'), 'The Spec');
});

test('a titled Ticket tile has the tooltip "<title> (<path>)", an untitled or remote one the path', () => {
  const run = runView({
    tickets: ['.scratch/f/issues/01-a.md', '.scratch/f/issues/02-b.md', 'https://github.com/o/r/issues/7'],
    titles: { '.scratch/f/issues/01-a.md': '01 <b>Skeleton</b>' },
  });
  assert.deepEqual(
    ticketsOf(run).map((t) => t.tooltip),
    ['01 <b>Skeleton</b> (.scratch/f/issues/01-a.md)', '.scratch/f/issues/02-b.md', 'https://github.com/o/r/issues/7'],
  );
});
