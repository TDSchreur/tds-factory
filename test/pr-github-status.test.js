import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseStatus, statusAsync } from '../src/pr-github.js';
import { providerFor } from '../src/pr-provider.js';

const URL_ = 'https://github.com/o/r/pull/1';
// merged-real.json is real `gh pr view --json state,mergeable,reviewDecision,statusCheckRollup,isDraft` output, recorded from merged PR #344 (check URLs shortened).
// Every other state below is an edited copy of it: no real conflicting, failing or draft PR was recorded.
const real = () => JSON.parse(readFileSync(new URL('./fixtures/pr-status/merged-real.json', import.meta.url), 'utf8'));
const open = (edit = () => {}) => { const v = real(); v.state = 'OPEN'; v.mergeable = 'MERGEABLE'; edit(v); return v; };

test('the recorded merged PR parses to a merged status with passing checks', () => {
  const status = parseStatus(real());
  assert.equal(status.state, 'merged');
  assert.deepEqual(status.checks, { result: 'passing', failing: [] });
  assert.equal(status.merge, 'unknown');
  assert.equal(status.review, 'none');
  assert.equal(status.draft, false);
});

test('an open PR: passing, failing, pending and no checks', () => {
  assert.deepEqual(parseStatus(open()), { state: 'open', draft: false, checks: { result: 'passing', failing: [] }, merge: 'mergeable', review: 'none' });
  const failing = parseStatus(open((v) => { v.statusCheckRollup[1].conclusion = 'FAILURE'; v.statusCheckRollup[2].conclusion = 'TIMED_OUT'; }));
  assert.equal(failing.checks.result, 'failing');
  assert.deepEqual(failing.checks.failing, [real().statusCheckRollup[1].name, real().statusCheckRollup[2].name]);
  const pending = parseStatus(open((v) => { v.statusCheckRollup[0].status = 'IN_PROGRESS'; v.statusCheckRollup[0].conclusion = ''; }));
  assert.equal(pending.checks.result, 'pending');
  assert.equal(parseStatus(open((v) => { v.statusCheckRollup = []; })).checks.result, 'none');
  assert.equal(parseStatus(open((v) => { v.statusCheckRollup = null; })).checks.result, 'none');
  assert.equal(parseStatus(open((v) => { v.statusCheckRollup[0].conclusion = 'SKIPPED'; v.statusCheckRollup[1].conclusion = 'NEUTRAL'; })).checks.result, 'passing');
});

test('a failing check wins over a pending one, and status contexts count', () => {
  const both = parseStatus(open((v) => { v.statusCheckRollup = [{ __typename: 'CheckRun', name: 'a', status: 'QUEUED', conclusion: '' }, { __typename: 'StatusContext', context: 'ci/x', state: 'FAILURE' }]; }));
  assert.deepEqual(both.checks, { result: 'failing', failing: ['ci/x'] });
  assert.equal(parseStatus(open((v) => { v.statusCheckRollup = [{ __typename: 'StatusContext', context: 'ci/x', state: 'PENDING' }]; })).checks.result, 'pending');
});

test('merge, review and draft', () => {
  assert.equal(parseStatus(open((v) => { v.mergeable = 'CONFLICTING'; })).merge, 'conflicting');
  assert.equal(parseStatus(open((v) => { v.mergeable = 'UNKNOWN'; })).merge, 'unknown');
  for (const [given, wanted] of [['APPROVED', 'approved'], ['CHANGES_REQUESTED', 'changes-requested'], ['REVIEW_REQUIRED', 'required'], ['', 'none'], [null, 'none'], ['SOMETHING', 'none']]) assert.equal(parseStatus(open((v) => { v.reviewDecision = given; })).review, wanted, String(given));
  assert.equal(parseStatus(open((v) => { v.isDraft = true; })).draft, true);
  assert.equal(parseStatus(open((v) => { v.isDraft = 'yes'; })).draft, false);
});

test('failing check names are limited in number and length', () => {
  const status = parseStatus(open((v) => { v.statusCheckRollup = Array.from({ length: 9 }, (_, i) => ({ __typename: 'CheckRun', name: 'x'.repeat(200) + i, status: 'COMPLETED', conclusion: 'FAILURE' })); }));
  assert.equal(status.checks.failing.length, 5);
  assert.ok(status.checks.failing.every((n) => n.length <= 80));
});

test('a response of the wrong shape is refused', () => {
  for (const bad of [null, 'x', [], {}, { state: 'WEIRD', statusCheckRollup: [] }, { state: 'OPEN', statusCheckRollup: 'x' }, { state: 'OPEN', statusCheckRollup: [null] }, { state: 'OPEN', statusCheckRollup: [{ __typename: 'Other' }] }, { state: 'OPEN', statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED' }] }]) {
    assert.throws(() => parseStatus(bad), /incomplete GitHub PR status/);
  }
});

test('statusAsync asks gh for exactly the status fields and parses the answer', async () => {
  const calls = [];
  const status = await statusAsync(URL_, { run: async (args) => { calls.push(args); return { stdout: JSON.stringify(open()) }; } });
  assert.equal(status.state, 'open');
  assert.deepEqual(calls, [['pr', 'view', URL_, '--json', 'state,mergeable,reviewDecision,statusCheckRollup,isDraft']]);
});

test('statusAsync names why it failed', async () => {
  const fail = (err) => statusAsync(URL_, { run: async () => { throw err; } }).then(() => assert.fail('expected failure'), (e) => e.reason);
  assert.equal(await fail(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })), 'gh-missing');
  assert.equal(await fail(Object.assign(new Error('x'), { stderr: 'To get started with GitHub CLI, please run:  gh auth login' })), 'not-signed-in');
  assert.equal(await fail(Object.assign(new Error('x'), { stderr: 'HTTP 403: API rate limit exceeded' })), 'rate-limited');
  assert.equal(await fail(Object.assign(new Error('x'), { stderr: 'boom' })), 'error');
  assert.equal(await statusAsync(URL_, { run: async () => ({ stdout: 'not json' }) }).then(() => 'ok', (e) => e.reason), 'error');
});

test('statusAsync refuses a link that is not a GitHub pull request, and the seam exposes it', async () => {
  await assert.rejects(statusAsync('https://example.com/pr/1', { run: async () => assert.fail('no call') }), /not a GitHub pull request/);
  assert.equal(typeof providerFor(URL_).statusAsync, 'function');
});
