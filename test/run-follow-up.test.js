import { finishProblems } from '../src/evidence.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, git } from './git-repo.js';

const cli = resolve('bin/tds-factory.js');
const page = (nodes, next = false, cursor = null) => ({ nodes, pageInfo: { hasNextPage: next, endCursor: cursor } });
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${join(cwd, 'fake-bin')}:${process.env.PATH}`, FAKE_GH: join(cwd, 'gh.json') } });
function fixture() {
  const cwd = repo();
  mkdirSync(join(cwd, 'fake-bin'));
  const gh = join(cwd, 'fake-bin', 'gh');
  writeFileSync(gh, `#!/usr/bin/env node\nconst fs = require('fs');\nconst s = JSON.parse(fs.readFileSync(process.env.FAKE_GH));\nconst args = process.argv.slice(2);\nfs.appendFileSync(process.env.FAKE_GH + '.log', JSON.stringify(args) + '\\n');\nif (s.error) { process.exit(1); }\nif (args[0] === 'pr') console.log(JSON.stringify(s.pr));\nelse { const q = args.find(x => x.startsWith('query=')) || ''; const key = q.includes('FollowUpChecks') ? 'checks' : q.includes('FollowUpThreads') ? 'threads' : 'comments'; const cursor = (args.find(x => x.startsWith('cursor=')) || 'cursor=').slice(7); const id = (args.find(x => x.startsWith('thread=')) || 'thread=').slice(7); console.log(JSON.stringify((s[key][id ? id + ':' + cursor : cursor]))); }\n`);
  chmodSync(gh, 0o755);
  const out = run(cwd, 'start', '--data', JSON.stringify({ title: 'PR follow up', agent: 'codex', commands: 'true', conventions: [] }));
  assert.equal(out.status, 0, out.stderr);
  const id = out.stdout.trim(), file = join(cwd, '.factory', 'runs', id, 'run.json');
  const record = JSON.parse(readFileSync(file));
  const head = git(record.worktree, 'rev-parse', 'HEAD');
  const pr = 'https://github.com/o/r/pull/7';
  Object.assign(record, { stage: 'finish', status: 'done', pr, tickets_total: 1, tickets_done: 1, standards: 'pass', spec: 'pass', security: 'pass', infrastructure: 'skipped', verify: { head }, reviewed: { standards: { head, attempt: 1 } }, accepted: { head }, project_results: { accessibility: { head } } });
  writeFileSync(file, JSON.stringify(record));
  const state = { pr: { state: 'OPEN', headRefOid: head }, checks: { '': { data: { repository: { pullRequest: { headRefOid: head, commits: { nodes: [{ commit: { statusCheckRollup: { contexts: page([{ __typename: 'CheckRun', name: 'unit', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/1' }]) } } }] } } } } } }, threads: { '': { data: { repository: { pullRequest: { headRefOid: head, reviewThreads: page([{ id: 'T1', isResolved: false, path: 'src/a.js', comments: page([{ body: 'Fix this', url: 'https://github.com/o/r/pull/7#discussion_r1' }]) }]) } } } } }, comments: {} };
  const save = () => writeFileSync(join(cwd, 'gh.json'), JSON.stringify(state));
  const read = () => JSON.parse(readFileSync(file));
  save();
  return { cwd, id, file, pr, head, state, save, read };
}

test('follow-up turns failing CI and unresolved review comments into scoped Rework with fresh Evidence', () => {
  const f = fixture();
  const before = f.read();
  const result = run(f.cwd, 'follow-up', '--id', f.id);
  assert.equal(result.status, 0, result.stderr);
  const after = f.read();
  assert.equal(after.title, before.title);
  assert.deepEqual(after.metrics.verdicts, before.metrics.verdicts, 'observed Check history stays');
  assert.equal(after.stage, 'build');
  assert.equal(after.status, 'running');
  assert.equal(after.check_loops, 1);
  assert.equal(after.pr, f.pr);
  assert.equal(after.follow_up.head, f.head);
  assert.equal(after.follow_up.failures[0].name, 'unit');
  assert.equal(after.follow_up.threads[0].comments[0].body, 'Fix this');
  for (const key of ['verify', 'reviewed', 'accepted', 'standards', 'spec', 'security', 'infrastructure', 'project_results']) assert.equal(key in after, false, key);
  assert.ok(finishProblems(after, { head: f.head, dirty: false }).length > 0, 'cleared Evidence cannot authorize Finish');
});

test('follow-up reads every page and excludes resolved threads and nonfailing checks', () => {
  const f = fixture();
  const checkNode = f.state.checks[''].data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup.contexts;
  checkNode.nodes = [{ __typename: 'StatusContext', context: 'lint', state: 'SUCCESS', targetUrl: null, description: null }];
  checkNode.pageInfo = { hasNextPage: true, endCursor: 'checks2' };
  f.state.checks.checks2 = { data: { repository: { pullRequest: { headRefOid: f.head, commits: { nodes: [{ commit: { statusCheckRollup: { contexts: page([{ __typename: 'StatusContext', context: 'deploy', state: 'FAILURE', targetUrl: 'https://example.test/status', description: 'broken' }]) } } }] } } } } };
  const first = f.state.threads[''].data.repository.pullRequest.reviewThreads;
  first.nodes[0].comments.pageInfo = { hasNextPage: true, endCursor: 'comments2' };
  first.nodes.push({ id: 'T2', isResolved: true, path: 'old.js', comments: page([{ body: 'resolved', url: 'https://example.test/old' }]) });
  first.pageInfo = { hasNextPage: true, endCursor: 'threads2' };
  f.state.threads.threads2 = { data: { repository: { pullRequest: { headRefOid: f.head, reviewThreads: page([{ id: 'T3', isResolved: false, path: 'b.js', comments: page([{ body: 'second thread', url: 'https://example.test/2' }]) }]) } } } };
  f.state.comments['T1:comments2'] = { data: { node: { id: 'T1', comments: page([{ body: 'reply', url: 'https://example.test/reply' }]) } } };
  f.save();
  const result = run(f.cwd, 'follow-up', '--id', f.id);
  assert.equal(result.status, 0, result.stderr);
  const scope = f.read().follow_up;
  assert.deepEqual(scope.failures.map(c => c.name), ['deploy']);
  assert.deepEqual(scope.threads.map(t => t.id), ['T1', 'T3']);
  assert.deepEqual(scope.threads[0].comments.map(c => c.body), ['Fix this', 'reply']);
});

test('clean or pending reads remain in Follow-up and can be completed and reopened', () => {
  const f = fixture();
  f.state.checks[''].data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup.contexts.nodes = [{ __typename: 'CheckRun', name: 'CI', status: 'IN_PROGRESS', conclusion: null, detailsUrl: null }];
  f.state.threads[''].data.repository.pullRequest.reviewThreads.nodes = [];
  f.save();
  assert.equal(run(f.cwd, 'follow-up', '--id', f.id).status, 0);
  assert.equal(f.read().stage, 'follow-up');
  assert.equal(f.read().follow_up.pending, true);
  assert.equal(f.read().check_loops, 0);
  assert.equal(run(f.cwd, 'complete', '--id', f.id).status, 0);
  assert.equal(f.read().status, 'done');
  assert.equal(run(f.cwd, 'follow-up', '--id', f.id).status, 0);
  assert.equal(f.read().status, 'running');
});

test('the shared four-Rework limit retains scope without clearing Evidence or entering Build', () => {
  const f = fixture();
  writeFileSync(f.file, JSON.stringify({ ...f.read(), check_loops: 4 }));
  const result = run(f.cwd, 'follow-up', '--id', f.id);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /limit of 4/);
  const after = f.read();
  assert.equal(after.stage, 'follow-up');
  assert.equal(after.check_loops, 4);
  assert.equal(after.follow_up.failures[0].name, 'unit');
  assert.equal(after.verify.head, f.head);
});

test('merged PR ends Follow-up without a worktree; closed PR refuses unchanged', () => {
  const f = fixture();
  f.state.pr.state = 'CLOSED'; f.save();
  let before = f.read();
  assert.notEqual(run(f.cwd, 'follow-up', '--id', f.id).status, 0);
  assert.deepEqual(f.read(), before);
  f.state.pr.state = 'MERGED'; f.save();
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
  f.state.pr.state = 'MERGED'; f.save();
  const before = f.read();
  assert.notEqual(run(f.cwd, 'follow-up', '--id', f.id).status, 0);
  assert.deepEqual(f.read(), before);
});

test('Follow-up cannot forge scope with update and a new head needs new Check Evidence', () => {
  const f = fixture();
  assert.notEqual(run(f.cwd, 'update', '--id', f.id, '--data', JSON.stringify({ follow_up: { failures: [] } })).status, 0);
  assert.equal(run(f.cwd, 'follow-up', '--id', f.id).status, 0);
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
  assert.equal(f.read().metrics.visits.at(-1).stage, 'follow-up');
  assert.equal(run(f.cwd, 'follow-up', '--id', f.id).status, 0);
  assert.equal(f.read().metrics.visits.at(-1).stage, 'build');
  assert.ok(f.read().metrics.visits.some(v => v.stage === 'follow-up' && v.ended));
});

test('a loop the user granted raises the shared limit for Follow-up too', () => {
  const f = fixture();
  writeFileSync(f.file, JSON.stringify({ ...f.read(), check_loops: 4, extra_loops: 1 }));
  const result = run(f.cwd, 'follow-up', '--id', f.id);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /limit of/);
  const after = f.read();
  assert.equal(after.stage, 'build');
  assert.equal(after.check_loops, 5);
  // Back at the raised limit, Follow-up retains scope again.
  writeFileSync(f.file, JSON.stringify({ ...after, stage: 'finish', status: 'done' }));
  const again = run(f.cwd, 'follow-up', '--id', f.id);
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
