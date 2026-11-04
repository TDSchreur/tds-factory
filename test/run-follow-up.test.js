import { finishProblems } from '../src/evidence.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cliWith } from './cli-runner.js';
import { git } from './git-repo.js';
import { fixture, page, run } from './follow-up-fixture.js';
import { envWith, fakeCommand } from './fake-command.js';
import { defined, metricsOf } from './run-view.js';

/** @import { Run } from '../src/run-record.js' */

test('follow-up turns failing CI and unresolved review comments into scoped Rework with fresh Evidence', async () => {
  const f = await fixture();
  const before = f.read();
  const result = await run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'checks');
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

test('follow-up reads every page and excludes resolved threads and nonfailing checks', async () => {
  const f = await fixture();
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
  const result = await run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'checks');
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

test('clean or pending reads remain in Follow-up and can be completed and reopened', async () => {
  const f = await fixture();
  f.state.checks[''].data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup.contexts.nodes = [
    { __typename: 'CheckRun', name: 'CI', status: 'IN_PROGRESS', conclusion: null, detailsUrl: null },
  ];
  f.state.threads[''].data.repository.pullRequest.reviewThreads.nodes = [];
  f.save();
  assert.equal((await run(f.cwd, 'follow-up', '--id', f.id)).status, 0);
  assert.equal(f.read().stage, 'follow-up');
  assert.equal(defined(f.read().follow_up, 'the Run records its follow-up').pending, true);
  assert.equal(f.read().check_loops, 0);
  assert.equal((await run(f.cwd, 'complete', '--id', f.id)).status, 0);
  assert.equal(f.read().status, 'done');
  assert.equal((await run(f.cwd, 'follow-up', '--id', f.id)).status, 0);
  assert.equal(f.read().status, 'running');
});

test('the shared four-Rework limit retains scope without clearing Evidence or entering Build', async () => {
  const f = await fixture();
  writeFileSync(f.file, JSON.stringify({ ...f.read(), check_loops: 4 }));
  const result = await run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'checks');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /limit of 4/);
  const after = f.read();
  assert.equal(after.stage, 'follow-up');
  assert.equal(after.check_loops, 4);
  assert.equal(defined(after.follow_up, 'the Run records its follow-up').failures[0].name, 'unit');
  assert.equal(after.verify?.head, f.head);
});

test('merged PR ends Follow-up without a worktree; closed PR refuses unchanged', async () => {
  const f = await fixture();
  f.state.pr.state = 'CLOSED';
  f.save();
  const before = f.read();
  assert.notEqual((await run(f.cwd, 'follow-up', '--id', f.id)).status, 0);
  assert.deepEqual(f.read(), before);
  f.state.pr.state = 'MERGED';
  f.save();
  git(f.cwd, 'worktree', 'remove', before.worktree);
  assert.equal((await run(f.cwd, 'follow-up', '--id', f.id)).status, 0);
  assert.equal(f.read().status, 'done');
  assert.equal(f.read().stage, 'follow-up');
});

test('unavailable, incomplete, dirty and head-mismatched reads leave the Run unchanged', async () => {
  for (const mode of ['failure', 'incomplete', 'head', 'dirty', 'url']) {
    const f = await fixture();
    if (mode === 'failure') f.state.error = true;
    if (mode === 'incomplete') delete f.state.threads[''].data.repository.pullRequest.reviewThreads.pageInfo;
    if (mode === 'head') f.state.pr.headRefOid = 'a'.repeat(40);
    if (mode === 'dirty') writeFileSync(join(f.read().worktree, 'uncommitted'), 'work');
    if (mode === 'url') writeFileSync(f.file, JSON.stringify({ ...f.read(), pr: 'https://example.com/pull/1' }));
    f.save();
    const before = f.read();
    assert.notEqual((await run(f.cwd, 'follow-up', '--id', f.id)).status, 0, mode);
    assert.deepEqual(f.read(), before, mode);
  }
});

test('an invalid PR number cannot end a Run even if GitHub says merged', async () => {
  const f = await fixture();
  writeFileSync(f.file, JSON.stringify({ ...f.read(), pr: 'https://github.com/o/r/pull/0' }));
  f.state.pr.state = 'MERGED';
  f.save();
  const before = f.read();
  assert.notEqual((await run(f.cwd, 'follow-up', '--id', f.id)).status, 0);
  assert.deepEqual(f.read(), before);
});

test('Follow-up cannot forge scope with update and a new head needs new Check Evidence', async () => {
  const f = await fixture();
  assert.notEqual(
    (await run(f.cwd, 'update', '--id', f.id, '--data', JSON.stringify({ follow_up: { failures: [] } }))).status,
    0,
  );
  assert.equal((await run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'checks')).status, 0);
  git(f.read().worktree, 'commit', '-q', '--allow-empty', '-m', 'fix feedback');
  assert.equal((await run(f.cwd, 'transition', '--id', f.id, '--to', 'check')).status, 0);
  assert.notEqual((await run(f.cwd, 'transition', '--id', f.id, '--to', 'finish')).status, 0);
});

test('only eligible Runs enter Follow-up and metrics preserve the visit', async () => {
  const f = await fixture();
  const before = f.read();
  writeFileSync(f.file, JSON.stringify({ ...before, stage: 'build', status: 'running' }));
  assert.notEqual((await run(f.cwd, 'follow-up', '--id', f.id)).status, 0);
  writeFileSync(f.file, JSON.stringify({ ...before, status: 'running', pr: '' }));
  assert.notEqual((await run(f.cwd, 'transition', '--id', f.id, '--to', 'follow-up')).status, 0);
  writeFileSync(f.file, JSON.stringify({ ...before, status: 'running' }));
  assert.equal((await run(f.cwd, 'transition', '--id', f.id, '--to', 'follow-up')).status, 0);
  assert.equal(metricsOf(f.read()).visits.at(-1)?.stage, 'follow-up');
  assert.equal((await run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'checks')).status, 0);
  assert.equal(metricsOf(f.read()).visits.at(-1)?.stage, 'build');
  assert.ok(metricsOf(f.read()).visits.some((v) => v.stage === 'follow-up' && v.ended));
});

test('a loop the user granted raises the shared limit for Follow-up too', async () => {
  const f = await fixture();
  writeFileSync(f.file, JSON.stringify({ ...f.read(), check_loops: 4, extra_loops: 1 }));
  const result = await run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'checks');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /limit of/);
  const after = f.read();
  assert.equal(after.stage, 'build');
  assert.equal(after.check_loops, 5);
  // Back at the raised limit, Follow-up retains scope again.
  writeFileSync(f.file, JSON.stringify({ ...after, stage: 'finish', status: 'done' }));
  const again = await run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'checks');
  assert.match(again.stdout, /limit of 5/);
});

/**
 * A fake `az` that answers `repos pr show`, `repos pr policy list` and the two `devops invoke` reads from az.json.
 * @param {Awaited<ReturnType<typeof fixture>>} f
 * @param {string} head
 */
function azureFixture(f, head) {
  const pr = 'https://dev.azure.com/o/p/_git/r/pullrequest/7';
  writeFileSync(f.file, JSON.stringify({ ...f.read(), pr }));
  const answers = {
    show: {
      status: 'active',
      mergeStatus: 'succeeded',
      lastMergeSourceCommit: { commitId: head },
      repository: {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'r',
        project: { id: '00000000-0000-4000-8000-000000000001', name: 'p' },
      },
    },
    policies: [],
    pullRequestStatuses: {
      value: [{ id: 1, state: 'failed', context: { name: 'ci', genre: 'g' }, targetUrl: 'https://ci.example/1' }],
    },
    pullRequestThreads: {
      value: [
        {
          id: 3,
          status: 'active',
          comments: [{ id: 1, commentType: 'text', content: 'Fix this' }],
          threadContext: { filePath: '/a.js' },
        },
      ],
    },
  };
  const file = join(f.cwd, 'az.json');
  writeFileSync(file, JSON.stringify(answers));
  fakeCommand(
    join(f.cwd, 'fake-bin'),
    'az',
    `const fs = require('fs');\nconst a = JSON.parse(fs.readFileSync(process.env.FAKE_AZ));\nconst args = process.argv.slice(2);\nfs.appendFileSync(process.env.FAKE_AZ + '.log', JSON.stringify(args) + '\\n');\nconst r = args.includes('--resource') ? args[args.indexOf('--resource') + 1] : null;\nconsole.log(JSON.stringify(r ? a[r] : args[2] === 'show' ? a.show : a.policies));\n`,
  );
  return { pr, file, answers };
}
/** @param {Awaited<ReturnType<typeof fixture>>} f @param {string[]} args */
const runAzure = async (f, ...args) =>
  await cliWith({ env: envWith(join(f.cwd, 'fake-bin'), { FAKE_AZ: join(f.cwd, 'az.json') }) }, f.cwd, 'run', ...args);
const windows = { skip: process.platform === 'win32' && 'the fake az.exe cannot stand in for az.cmd behind cmd.exe' };

test('follow-up works for an Azure DevOps PR: the scope sends only its findings to Build', windows, async () => {
  const f = await fixture();
  azureFixture(f, f.head);
  const none = await runAzure(f, 'follow-up', '--id', f.id);
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /choose what to work on with --scope/);
  assert.doesNotMatch(none.stderr, /GitHub/);
  const result = await runAzure(f, 'follow-up', '--id', f.id, '--scope', 'comments');
  assert.equal(result.status, 0, result.stderr);
  const after = f.read();
  assert.equal(after.stage, 'build');
  const snapshot = defined(after.follow_up, 'the Run records its follow-up');
  assert.equal(snapshot.scope, 'comments');
  assert.equal(snapshot.head, f.head);
  assert.deepEqual(snapshot.threads, [
    {
      id: '3',
      path: '/a.js',
      comments: [{ body: 'Fix this', url: 'https://dev.azure.com/o/p/_git/r/pullrequest/7?discussionId=3' }],
    },
  ]);
  assert.equal(snapshot.failures[0].name, 'g/ci');
  assert.equal(snapshot.conflicts, false);
});

test(
  'follow-up for an Azure DevOps PR refuses a head that differs and a closed PR, changing nothing',
  windows,
  async () => {
    const f = await fixture();
    const { file, answers } = azureFixture(f, 'a'.repeat(40));
    const before = readFileSync(f.file, 'utf8');
    const result = await runAzure(f, 'follow-up', '--id', f.id, '--scope', 'checks');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /worktree head differs from the PR head/);
    assert.equal(readFileSync(f.file, 'utf8'), before);
    writeFileSync(file, JSON.stringify({ ...answers, show: { ...answers.show, status: 'abandoned' } }));
    const closed = await runAzure(f, 'follow-up', '--id', f.id);
    assert.match(closed.stderr, /closed without a merge/);
    assert.equal(readFileSync(f.file, 'utf8'), before);
  },
);

test('follow-up for a completed Azure DevOps PR is Done', windows, async () => {
  const f = await fixture();
  const { file, answers } = azureFixture(f, f.head);
  writeFileSync(file, JSON.stringify({ ...answers, show: { ...answers.show, status: 'completed' } }));
  const result = await runAzure(f, 'follow-up', '--id', f.id);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.read().status, 'done');
  assert.match(result.stdout, /merged/);
});

/** @param {Awaited<ReturnType<typeof fixture>>} f */
const conflicting = (f) => {
  f.state.checks[''].data.repository.pullRequest.mergeable = 'CONFLICTING';
  f.save();
};

test('each scope starts a Rework only for its own findings and keeps the others in the snapshot', async () => {
  for (const scope of ['conflicts', 'checks', 'comments']) {
    const f = await fixture();
    conflicting(f);
    const result = await run(f.cwd, 'follow-up', '--id', f.id, '--scope', scope);
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

test('a scope without a finding stays in Follow-up and says so', async () => {
  /** @type {[string, (f: Awaited<ReturnType<typeof fixture>>) => void][]} */
  const cases = [
    ['conflicts', () => {}],
    [
      'checks',
      (/** @type {Awaited<ReturnType<typeof fixture>>} */ f) => {
        f.state.checks[''].data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup.contexts.nodes = [];
      },
    ],
    [
      'comments',
      (/** @type {Awaited<ReturnType<typeof fixture>>} */ f) => {
        f.state.threads[''].data.repository.pullRequest.reviewThreads.nodes = [];
      },
    ],
  ];
  for (const [scope, clear] of cases) {
    const f = await fixture();
    clear(f);
    f.save();
    const result = await run(f.cwd, 'follow-up', '--id', f.id, '--scope', String(scope));
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

test('conflicts are read from GitHub into the snapshot; UNKNOWN is no finding', async () => {
  const f = await fixture();
  assert.equal((await run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'comments')).status, 0);
  assert.equal(f.read().follow_up?.conflicts, false);
  const g = await fixture();
  g.state.checks[''].data.repository.pullRequest.mergeable = 'UNKNOWN';
  g.save();
  assert.equal((await run(g.cwd, 'follow-up', '--id', g.id, '--scope', 'conflicts')).status, 0);
  assert.equal(g.read().follow_up?.conflicts, false);
  assert.equal(g.read().stage, 'follow-up');
  const h = await fixture();
  delete h.state.checks[''].data.repository.pullRequest.mergeable;
  h.save();
  const before = h.read();
  assert.notEqual((await run(h.cwd, 'follow-up', '--id', h.id, '--scope', 'checks')).status, 0);
  assert.deepEqual(h.read(), before, 'an unreadable merge state leaves the Run unchanged');
});

test('--scope is validated, and findings without a scope are refused with the allowed scopes', async () => {
  const f = await fixture();
  const before = f.read();
  const bad = await run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'everything');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /conflicts, checks or comments/);
  const missing = await run(f.cwd, 'follow-up', '--id', f.id);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--scope conflicts\|checks\|comments/);
  assert.match(missing.stderr, /checks, comments/, 'names the scopes that have findings');
  assert.deepEqual(f.read(), before, 'a refusal changes nothing');
  assert.equal(readFileSync(join(f.cwd, 'gh.json.log'), 'utf8').includes('graphql'), true);
  // Without findings no scope is needed.
  const g = await fixture();
  g.state.checks[''].data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup.contexts.nodes = [];
  g.state.threads[''].data.repository.pullRequest.reviewThreads.nodes = [];
  g.save();
  assert.equal((await run(g.cwd, 'follow-up', '--id', g.id)).status, 0);
  assert.equal(g.read().stage, 'follow-up');
});
