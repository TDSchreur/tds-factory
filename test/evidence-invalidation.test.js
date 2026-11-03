import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearEvidence } from '../src/evidence.js';

/** @import { Run } from '../src/run-record.js' */

/** @returns {Run} */
const record = () => ({
  worktree: '/work',
  stage: 'check',
  title: 'Keep me',
  check_loops: 2,
  base_sha: 'b',
  pr: 'https://github.com/o/r/pull/1',
  standards: 'pass',
  spec: 'pass',
  security: 'pass',
  infrastructure: 'skipped',
  verify: { command: 'npm test', head: 'h', dirty: false, exit_code: 0, started: '', ended: '', log: '' },
  reviewed: { standards: { head: 'h', attempt: 1 } },
  accepted: { head: 'h' },
  project_results: { a11y: { verdict: 'pass', head: 'h', attempt: 1 } },
  metrics: { version: 1, visits: [], verdicts: [{ axis: 'standards', value: 'pass', head: 'h', at: '' }] },
  follow_up: {
    pr: '',
    head: 'h',
    observed: '',
    conflicts: false,
    checks: [],
    failures: [],
    pending: false,
    threads: [],
  },
});

test('clearEvidence drops every current Evidence field and keeps the rest, including history', () => {
  const before = record();
  const after = clearEvidence(before);
  /** @type {(keyof Run)[]} */
  const evidence = [
    'standards',
    'spec',
    'security',
    'infrastructure',
    'verify',
    'reviewed',
    'accepted',
    'project_results',
  ];
  for (const key of evidence) assert.equal(key in after, false, key);
  const rest = record();
  for (const key of evidence) delete rest[key];
  assert.deepEqual(after, rest);
  assert.equal(before.verify?.head, 'h', 'the input is not changed');
});
