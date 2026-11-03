import { finishProblems } from '../src/evidence.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git-repo.js';
import { fixture, page, run } from './follow-up-fixture.js';
import { defined, metricsOf } from './run-view.js';

/** @import { Run } from '../src/run-record.js' */

test('follow-up turns failing CI and unresolved review comments into scoped Rework with fresh Evidence', () => {
  const f = fixture();
  const before = f.read();
  const result = run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'checks');
  assert.equal(result.status, 0, result.stderr);
  const after = f.read();
  assert.equal(after.title, before.title);
  assert.deepEqual(metricsOf(after).verdicts, metricsOf(before).verdicts, 'observed Check history stays');
  assert.equal(after.stage, 'build');
  assert.equal(after.status, 'running');
  assert.equal(after.check_loops, 1);
  assert.equal(after.pr, f.pr);
  assert.equal(defined(after.follow_up, 'the Run records its follow-up').head, f.head);
  assert.equal(defined(after.follow_up, 'the Run records its follow-up').failures[0].name, 'unit');
  assert.equal(defined(after.follow_up, 'the Run records its follow-up').threads[0].comments[0].body, 'Fix this');
  assert.equal(defined(after.follow_up, 'the Run records its follow-up').scope, 'checks');
  for (const key of [
    'verify',
    'reviewed',
    'accepted',
    'standards',
    'spec',
    'security',
    'infrastructure',
    'project_results',
  ])
    assert.equal(key in after, false, key);
  assert.ok(
    finishProblems(after, { head: f.head, dirty: false }).length > 0,
    'cleared Evidence cannot authorize Finish',
  );
});

test('follow-up reads every page and excludes resolved threads and nonfailing checks', () => {
  const f = fixture();
  const checkNode = f.state.checks[''].data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup.contexts;
  checkNode.nodes = [
    { __typename: 'StatusContext', context: 'lint', state: 'SUCCESS', targetUrl: null, description: null },
  ];
  checkNode.pageInfo = { hasNextPage: true, endCursor: 'checks2' };
  f.state.checks.checks2 = {
    data: {
      repository: {
        pullRequest: {
          headRefOid: f.head,
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    contexts: page([
                      {
                        __typename: 'StatusContext',
                        context: 'deploy',
                        state: 'FAILURE',
                        targetUrl: 'https://example.test/status',
                        description: 'broken',
                      },
                    ]),
                  },
                },
              },
            ],
          },
        },
      },
    },
  };
  const first = f.state.threads[''].data.repository.pullRequest.reviewThreads;
  first.nodes[0].comments.pageInfo = { hasNextPage: true, endCursor: 'comments2' };
  first.nodes.push({
    id: 'T2',
    isResolved: true,
    path: 'old.js',
    comments: page([{ body: 'resolved', url: 'https://example.test/old' }]),
  });
  first.pageInfo = { hasNextPage: true, endCursor: 'threads2' };
  f.state.threads.threads2 = {
    data: {
      repository: {
        pullRequest: {
          headRefOid: f.head,
          reviewThreads: page([
            {
              id: 'T3',
              isResolved: false,
              path: 'b.js',
              comments: page([{ body: 'second thread', url: 'https://example.test/2' }]),
            },
          ]),
        },
      },
    },
  };
  f.state.comments['T1:comments2'] = {
    data: { node: { id: 'T1', comments: page([{ body: 'reply', url: 'https://example.test/reply' }]) } },
  };
  f.save();
  const result = run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'checks');
  assert.equal(result.status, 0, result.stderr);
  const scope = defined(f.read().follow_up, 'the Run records its follow-up');
  assert.deepEqual(
    scope.failures.map((c) => c.name),
    ['deploy'],
  );
  assert.deepEqual(
    scope.threads.map((t) => t.id),
    ['T1', 'T3'],
  );
  assert.deepEqual(
    scope.threads[0].comments.map((c) => c.body),
    ['Fix this', 'reply'],
  );
});

test('clean or pending reads remain in Follow-up and can be completed and reopened', () => {
  const f = fixture();
  f.state.checks[''].data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup.contexts.nodes = [
    { __typename: 'CheckRun', name: 'CI', status: 'IN_PROGRESS', conclusion: null, detailsUrl: null },
  ];
  f.state.threads[''].data.repository.pullRequest.reviewThreads.nodes = [];
  f.save();
  assert.equal(run(f.cwd, 'follow-up', '--id', f.id).status, 0);
  assert.equal(f.read().stage, 'follow-up');
  assert.equal(defined(f.read().follow_up, 'the Run records its follow-up').pending, true);
  assert.equal(f.read().check_loops, 0);
  assert.equal(run(f.cwd, 'complete', '--id', f.id).status, 0);
  assert.equal(f.read().status, 'done');
  assert.equal(run(f.cwd, 'follow-up', '--id', f.id).status, 0);
  assert.equal(f.read().status, 'running');
});

test('the shared four-Rework limit retains scope without clearing Evidence or entering Build', () => {
  const f = fixture();
  writeFileSync(f.file, JSON.stringify({ ...f.read(), check_loops: 4 }));
  const result = run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'checks');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /limit of 4/);
  const after = f.read();
  assert.equal(after.stage, 'follow-up');
  assert.equal(after.check_loops, 4);
  assert.equal(defined(after.follow_up, 'the Run records its follow-up').failures[0].name, 'unit');
  assert.equal(after.verify?.head, f.head);
});

test('merged PR ends Follow-up without a worktree; closed PR refuses unchanged', () => {
  const f = fixture();
  f.state.pr.state = 'CLOSED';
  f.save();
  const before = f.read();
  assert.notEqual(run(f.cwd, 'follow-up', '--id', f.id).status, 0);
  assert.deepEqual(f.read(), before);
  f.state.pr.state = 'MERGED';
  f.save();
  git(f.cwd, 'worktree', 'remove', before.worktree);
  assert.equal(run(f.cwd, 'follow-up', '--id', f.id).status, 0);
  assert.equal(f.read().status, 'done');
  assert.equal(f.read().stage, 'follow-up');
});

test('unavailable, incomplete, dirty and head-mismatched reads leave the Run unchanged', () => {
  for (const mode of ['failure', 'incomplete', 'head', 'dirty', 'url']) {
    const f = fixture();
    if (mode === 'failure') f.state.error = true;
    if (mode === 'incomplete') delete f.state.threads[''].data.repository.pullRequest.reviewThreads.pageInfo;
    if (mode === 'head') f.state.pr.headRefOid = 'a'.repeat(40);
    if (mode === 'dirty') writeFileSync(join(f.read().worktree, 'uncommitted'), 'work');
    if (mode === 'url') writeFileSync(f.file, JSON.stringify({ ...f.read(), pr: 'https://example.com/pull/1' }));
    f.save();
    const before = f.read();
    assert.notEqual(run(f.cwd, 'follow-up', '--id', f.id).status, 0, mode);
    assert.deepEqual(f.read(), before, mode);
  }
});

test('an invalid PR number cannot end a Run even if GitHub says merged', () => {
  const f = fixture();
  writeFileSync(f.file, JSON.stringify({ ...f.read(), pr: 'https://github.com/o/r/pull/0' }));
  f.state.pr.state = 'MERGED';
  f.save();
  const before = f.read();
  assert.notEqual(run(f.cwd, 'follow-up', '--id', f.id).status, 0);
  assert.deepEqual(f.read(), before);
});

test('Follow-up cannot forge scope with update and a new head needs new Check Evidence', () => {
  const f = fixture();
  assert.notEqual(
    run(f.cwd, 'update', '--id', f.id, '--data', JSON.stringify({ follow_up: { failures: [] } })).status,
    0,
  );
  assert.equal(run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'checks').status, 0);
  git(f.read().worktree, 'commit', '-q', '--allow-empty', '-m', 'fix feedback');
  assert.equal(run(f.cwd, 'transition', '--id', f.id, '--to', 'check').status, 0);
  assert.notEqual(run(f.cwd, 'transition', '--id', f.id, '--to', 'finish').status, 0);
});

test('only eligible Runs enter Follow-up and metrics preserve the visit', () => {
  const f = fixture();
  const before = f.read();
  writeFileSync(f.file, JSON.stringify({ ...before, stage: 'build', status: 'running' }));
  assert.notEqual(run(f.cwd, 'follow-up', '--id', f.id).status, 0);
  writeFileSync(f.file, JSON.stringify({ ...before, status: 'running', pr: '' }));
  assert.notEqual(run(f.cwd, 'transition', '--id', f.id, '--to', 'follow-up').status, 0);
  writeFileSync(f.file, JSON.stringify({ ...before, status: 'running' }));
  assert.equal(run(f.cwd, 'transition', '--id', f.id, '--to', 'follow-up').status, 0);
  assert.equal(metricsOf(f.read()).visits.at(-1)?.stage, 'follow-up');
  assert.equal(run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'checks').status, 0);
  assert.equal(metricsOf(f.read()).visits.at(-1)?.stage, 'build');
  assert.ok(metricsOf(f.read()).visits.some((v) => v.stage === 'follow-up' && v.ended));
});

test('a loop the user granted raises the shared limit for Follow-up too', () => {
  const f = fixture();
  writeFileSync(f.file, JSON.stringify({ ...f.read(), check_loops: 4, extra_loops: 1 }));
  const result = run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'checks');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /limit of/);
  const after = f.read();
  assert.equal(after.stage, 'build');
  assert.equal(after.check_loops, 5);
  // Back at the raised limit, Follow-up retains scope again.
  writeFileSync(f.file, JSON.stringify({ ...after, stage: 'finish', status: 'done' }));
  const again = run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'checks');
  assert.match(again.stdout, /limit of 5/);
});

test('follow-up refuses an Azure DevOps PR and changes nothing, without calling gh or az', () => {
  const f = fixture();
  const record = f.read();
  record.pr = 'https://dev.azure.com/o/p/_git/r/pullrequest/7';
  writeFileSync(f.file, JSON.stringify(record));
  const before = readFileSync(f.file, 'utf8');
  const result = run(f.cwd, 'follow-up', '--id', f.id);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Follow-up does not support Azure DevOps yet/);
  assert.equal(readFileSync(f.file, 'utf8'), before);
});

/** @param {ReturnType<typeof fixture>} f */
const conflicting = (f) => {
  f.state.checks[''].data.repository.pullRequest.mergeable = 'CONFLICTING';
  f.save();
};

test('each scope starts a Rework only for its own findings and keeps the others in the snapshot', () => {
  for (const scope of ['conflicts', 'checks', 'comments']) {
    const f = fixture();
    conflicting(f);
    const result = run(f.cwd, 'follow-up', '--id', f.id, '--scope', scope);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`${scope}`));
    const after = f.read();
    assert.equal(after.stage, 'build', scope);
    assert.equal(after.check_loops, 1, scope);
    const snapshot = defined(after.follow_up, 'the Run records its follow-up');
    assert.equal(snapshot.scope, scope);
    assert.equal(snapshot.conflicts, true, 'conflicts are a finding in the snapshot');
    assert.equal(snapshot.failures[0].name, 'unit', 'checks of other scopes are retained');
    assert.equal(snapshot.threads[0].id, 'T1', 'comments of other scopes are retained');
  }
});

test('a scope without a finding stays in Follow-up and says so', () => {
  /** @type {[string, (f: ReturnType<typeof fixture>) => void][]} */
  const cases = [
    ['conflicts', () => {}],
    [
      'checks',
      (/** @type {ReturnType<typeof fixture>} */ f) => {
        f.state.checks[''].data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup.contexts.nodes = [];
      },
    ],
    [
      'comments',
      (/** @type {ReturnType<typeof fixture>} */ f) => {
        f.state.threads[''].data.repository.pullRequest.reviewThreads.nodes = [];
      },
    ],
  ];
  for (const [scope, clear] of cases) {
    const f = fixture();
    clear(f);
    f.save();
    const result = run(f.cwd, 'follow-up', '--id', f.id, '--scope', String(scope));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`no ${scope} findings`));
    const after = f.read();
    assert.equal(after.stage, 'follow-up', String(scope));
    assert.equal(after.check_loops, 0, String(scope));
    assert.equal(after.follow_up?.scope, undefined, 'no Rework started, so no scope');
    assert.match(after.activity ?? '', new RegExp(`no ${scope} findings`));
    assert.equal(after.verify?.head, f.head, 'Evidence stays');
  }
});

test('conflicts are read from GitHub into the snapshot; UNKNOWN is no finding', () => {
  const f = fixture();
  assert.equal(run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'comments').status, 0);
  assert.equal(f.read().follow_up?.conflicts, false);
  const g = fixture();
  g.state.checks[''].data.repository.pullRequest.mergeable = 'UNKNOWN';
  g.save();
  assert.equal(run(g.cwd, 'follow-up', '--id', g.id, '--scope', 'conflicts').status, 0);
  assert.equal(g.read().follow_up?.conflicts, false);
  assert.equal(g.read().stage, 'follow-up');
  const h = fixture();
  delete h.state.checks[''].data.repository.pullRequest.mergeable;
  h.save();
  const before = h.read();
  assert.notEqual(run(h.cwd, 'follow-up', '--id', h.id, '--scope', 'checks').status, 0);
  assert.deepEqual(h.read(), before, 'an unreadable merge state leaves the Run unchanged');
});

test('--scope is validated, and findings without a scope are refused with the allowed scopes', () => {
  const f = fixture();
  const before = f.read();
  const bad = run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'everything');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /conflicts, checks or comments/);
  const missing = run(f.cwd, 'follow-up', '--id', f.id);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--scope conflicts\|checks\|comments/);
  assert.match(missing.stderr, /checks, comments/, 'names the scopes that have findings');
  assert.deepEqual(f.read(), before, 'a refusal changes nothing');
  assert.equal(readFileSync(join(f.cwd, 'gh.json.log'), 'utf8').includes('graphql'), true);
  // Without findings no scope is needed.
  const g = fixture();
  g.state.checks[''].data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup.contexts.nodes = [];
  g.state.threads[''].data.repository.pullRequest.reviewThreads.nodes = [];
  g.save();
  assert.equal(run(g.cwd, 'follow-up', '--id', g.id).status, 0);
  assert.equal(g.read().stage, 'follow-up');
});
