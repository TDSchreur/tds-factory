import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearEvidence } from '../src/evidence.js';

const record = () => ({
  stage: 'check',
  title: 'Keep me',
  check_loops: 2,
  base_sha: 'b',
  pr: 'https://github.com/o/r/pull/1',
  standards: 'pass',
  spec: 'pass',
  security: 'pass',
  infrastructure: 'skipped',
  verify: { head: 'h' },
  reviewed: { standards: { head: 'h', attempt: 1 } },
  accepted: { head: 'h' },
  project_results: { a11y: { head: 'h' } },
  metrics: { verdicts: [{ axis: 'standards', value: 'pass', head: 'h' }] },
  follow_up: { head: 'h' },
});

test('clearEvidence drops every current Evidence field and keeps the rest, including history', () => {
  const before = record();
  const after = clearEvidence(before);
  for (const key of [
    'standards',
    'spec',
    'security',
    'infrastructure',
    'verify',
    'reviewed',
    'accepted',
    'project_results',
  ])
    assert.equal(key in after, false, key);
  const rest = record();
  for (const key of [
    'standards',
    'spec',
    'security',
    'infrastructure',
    'verify',
    'reviewed',
    'accepted',
    'project_results',
  ])
    delete rest[key];
  assert.deepEqual(after, rest);
  assert.equal(before.verify.head, 'h', 'the input is not changed');
});
