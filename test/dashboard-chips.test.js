import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chipsOf } from '../dashboard/model.js';

const rows = (run) => chipsOf(run).map((c) => [c.key, c.icon, c.label, c.value, c.cls]);

test('each Run fact is a row with an icon, a label and a value', () => {
  assert.deepEqual(
    rows({
      track: 'fast',
      ticketsTotal: 2,
      ticketsDone: 1,
      standards: 'pass',
      spec: 'fail',
      security: 'pass',
      infrastructure: 'skipped',
      projectReviews: [{ id: 'ux', name: 'UX', verdict: 'pass' }],
      loops: 1,
      loopCap: 5,
    }),
    [
      ['track', '⚡', 'Track', 'Fast', 'accent'],
      ['tickets', '▣', 'Tickets', '1/2', 'accent'],
      ['standards', '✓', 'Standards', 'pass', 'pass'],
      ['spec', '✗', 'Spec', 'fail', 'fail'],
      ['security', '✓', 'Security', 'pass', 'pass'],
      ['infrastructure', '⊘', 'Infrastructure', 'skipped', 'skipped'],
      ['project-ux', '✓', 'UX', 'pass', 'pass'],
      ['loops', '↻', 'Check loops', '1/5', 'neutral'],
    ],
  );
});

test('the Full track has its own icon, and a Run with nothing recorded has no rows', () => {
  assert.deepEqual(rows({ track: 'full' }), [['track', '◆', 'Track', 'Full', 'accent']]);
  assert.deepEqual(rows({}), []);
});

test('every row has a plain-text reading and an explanation', () => {
  for (const c of chipsOf({ track: 'fast', standards: 'pass', loops: 0 })) {
    assert.equal(c.text, `${c.label} ${c.value}`);
    assert.ok(c.tip.length > 10, c.key);
  }
});
