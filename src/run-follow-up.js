import { spawnSync } from 'node:child_process';
import { changeRun } from './run-folder.js';
import { ownWorktrees, worktreeState } from './worktrees.js';
import { loops, MAX_CHECK_LOOPS, verdicts } from './run-record.js';
import { moveVisit } from './run-metrics.js';

// GitHub content is data: pass only validated identifiers as arguments, never shell text.
function gh(args, cwd) {
  const out = spawnSync('gh', args, { cwd, encoding: 'utf8', timeout: 20000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1' } });
  if (out.status !== 0) throw new Error(`cannot read GitHub PR: ${(out.stderr || out.error?.message || 'gh failed').trim()}`);
  try { return JSON.parse(out.stdout); } catch { throw new Error('malformed GitHub response'); }
}
const checksQuery = `query FollowUpChecks($owner:String!, $repo:String!, $number:Int!, $cursor:String) { repository(owner:$owner,name:$repo) { pullRequest(number:$number) { headRefOid commits(last:1) { nodes { commit { statusCheckRollup { contexts(first:100,after:$cursor) { nodes { __typename ... on CheckRun { name status conclusion detailsUrl } ... on StatusContext { context state targetUrl description } } pageInfo { hasNextPage endCursor } } } } } } } } }`;
const threadsQuery = `query FollowUpThreads($owner:String!, $repo:String!, $number:Int!, $cursor:String) { repository(owner:$owner,name:$repo) { pullRequest(number:$number) { headRefOid reviewThreads(first:100,after:$cursor) { nodes { id isResolved path comments(first:100) { nodes { body url } pageInfo { hasNextPage endCursor } } } pageInfo { hasNextPage endCursor } } } } }`;
const commentsQuery = `query FollowUpComments($thread:ID!, $cursor:String) { node(id:$thread) { ... on PullRequestReviewThread { id comments(first:100,after:$cursor) { nodes { body url } pageInfo { hasNextPage endCursor } } } } }`;
function graph(query, fields, cwd, cursor) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(fields)) args.push(key === 'number' ? '-F' : '-f', `${key}=${value}`);
  if (cursor) args.push('-f', `cursor=${cursor}`);
  const response = gh(args, cwd);
  if (!response || typeof response !== 'object' || response.errors || !response.data) throw new Error('incomplete GitHub response');
  return response.data;
}
function pages(fetch, select) {
  const all = [], seen = new Set();
  let cursor;
  while (true) {
    const connection = select(fetch(cursor));
    if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo || typeof connection.pageInfo.hasNextPage !== 'boolean') throw new Error('incomplete GitHub pagination');
    all.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return all;
    const next = connection.pageInfo.endCursor;
    if (typeof next !== 'string' || !next || seen.has(next) || seen.size >= 1000) throw new Error('incomplete GitHub pagination');
    seen.add(next); cursor = next;
  }
}
function validComment(comment) {
  if (!comment || typeof comment.body !== 'string' || typeof comment.url !== 'string' || !comment.url) throw new Error('incomplete GitHub review comment');
  return { body: comment.body, url: comment.url };
}
function checkState(check) {
  if (!check || !['CheckRun', 'StatusContext'].includes(check.__typename)) throw new Error('unknown GitHub check');
  if (check.__typename === 'StatusContext') {
    if (typeof check.context !== 'string' || !check.context || !['ERROR', 'FAILURE', 'PENDING', 'EXPECTED', 'SUCCESS'].includes(check.state)) throw new Error('incomplete GitHub status');
    return { name: check.context, state: check.state, url: check.targetUrl ?? null, description: check.description ?? null, failing: ['ERROR', 'FAILURE'].includes(check.state), pending: ['PENDING', 'EXPECTED'].includes(check.state) };
  }
  if (typeof check.name !== 'string' || !check.name || !['COMPLETED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'PENDING'].includes(check.status)) throw new Error('incomplete GitHub check run');
  const failures = ['ACTION_REQUIRED', 'CANCELLED', 'FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'STALE'];
  if (check.status === 'COMPLETED' && ![...failures, 'SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(check.conclusion)) throw new Error('incomplete GitHub check conclusion');
  return { name: check.name, state: check.status, conclusion: check.conclusion ?? null, url: check.detailsUrl ?? null, failing: check.status === 'COMPLETED' && failures.includes(check.conclusion), pending: check.status !== 'COMPLETED' };
}
function prInfo(url, cwd) {
  const value = gh(['pr', 'view', url, '--json', 'state,headRefOid'], cwd);
  if (!value || !['OPEN', 'CLOSED', 'MERGED'].includes(value.state) || typeof value.headRefOid !== 'string' || !/^[a-f0-9]{40,64}$/i.test(value.headRefOid)) throw new Error('incomplete GitHub PR state');
  return value;
}
function collect(url, head, cwd) {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/.exec(url);
  if (!match || !Number.isSafeInteger(Number(match[3])) || Number(match[3]) < 1) throw new Error('Follow-up needs a GitHub PR URL');
  const fields = { owner: match[1], repo: match[2], number: match[3] };
  const pr = (data) => {
    const value = data.repository?.pullRequest;
    if (!value || value.headRefOid !== head) throw new Error('GitHub PR head changed during Follow-up');
    return value;
  };
  const checks = pages((cursor) => graph(checksQuery, fields, cwd, cursor), (data) => {
    const commits = pr(data).commits?.nodes;
    if (!Array.isArray(commits) || commits.length !== 1 || !commits[0]?.commit || !Object.hasOwn(commits[0].commit, 'statusCheckRollup')) throw new Error('incomplete GitHub checks');
    const rollup = commits[0].commit.statusCheckRollup;
    return rollup === null ? { nodes: [], pageInfo: { hasNextPage: false } } : rollup?.contexts;
  }).map(checkState);
  const rawThreads = pages((cursor) => graph(threadsQuery, fields, cwd, cursor), (data) => pr(data).reviewThreads);
  const threads = [];
  for (const thread of rawThreads) {
    if (!thread || typeof thread.id !== 'string' || !thread.id || typeof thread.isResolved !== 'boolean' || typeof thread.path !== 'string') throw new Error('incomplete GitHub review thread');
    if (thread.isResolved) continue;
    let first = true;
    const comments = pages((cursor) => {
      if (first) { first = false; return thread.comments; }
      return graph(commentsQuery, { thread: thread.id }, cwd, cursor).node;
    }, (value) => value === thread.comments ? value : (value?.id === thread.id ? value.comments : null)).map(validComment);
    if (!comments.length) throw new Error('incomplete GitHub review thread');
    threads.push({ id: thread.id, path: thread.path, comments });
  }
  return { pr: url, head, observed: new Date().toISOString(), checks, failures: checks.filter((c) => c.failing), pending: checks.some((c) => c.pending), threads };
}
export function followUpRun(projectDir, id) {
  let result;
  changeRun(projectDir, id, (old) => {
    if (!['finish', 'follow-up'].includes(old.stage) || !['running', 'done'].includes(old.status)) throw new Error('Follow-up needs a running or done Run in Finish or Follow-up');
    if (typeof old.pr !== 'string' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(old.pr)) throw new Error('Follow-up needs a GitHub PR URL');
    const number = Number(old.pr.split('/').at(-1));
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Follow-up needs a GitHub PR URL');
    const state = prInfo(old.pr, projectDir);
    if (state.state === 'CLOSED') throw new Error('the PR is closed without a merge');
    if (state.state === 'MERGED') {
      const record = old.stage === 'follow-up' ? old : moveVisit(old, 'follow-up');
      result = 'PR merged; Follow-up is Done';
      return { ...moveVisit(record, null), stage: 'follow-up', status: 'done', activity: result, updated: new Date().toISOString() };
    }
    const own = ownWorktrees(projectDir).get(id);
    if (!own?.safe || own.branch !== id || old.worktree !== own.dir) throw new Error('the registered Run worktree is missing or invalid');
    const before = worktreeState(old);
    if (before.dirty || before.head !== state.headRefOid) throw new Error('Follow-up needs a clean Run worktree at the PR head');
    const snapshot = collect(old.pr, before.head, projectDir);
    const after = worktreeState(old), latest = prInfo(old.pr, projectDir);
    const registered = ownWorktrees(projectDir).get(id);
    if (!registered?.safe || registered.branch !== id || registered.dir !== own.dir || after.dirty || after.head !== before.head || latest.state !== 'OPEN' || latest.headRefOid !== before.head) throw new Error('the PR or Run worktree changed during Follow-up');
    let record = old.stage === 'follow-up' && old.status === 'running' ? old : moveVisit(old, 'follow-up');
    record = { ...record, stage: 'follow-up', status: 'running', waiting_on_human: false, waiting_reason: '', status_reason: '', follow_up: snapshot };
    if (snapshot.failures.length || snapshot.threads.length) {
      if (loops(record) >= MAX_CHECK_LOOPS) result = `Check loop limit of ${MAX_CHECK_LOOPS} reached; Follow-up scope retained`;
      else {
        record = { ...moveVisit(record, 'build'), stage: 'build', check_loops: loops(record) + 1 };
        for (const key of [...verdicts, 'verify', 'reviewed', 'accepted', 'project_results']) delete record[key];
        result = 'Follow-up scoped Rework: back to Build';
      }
    } else result = snapshot.pending ? 'Follow-up: CI pending' : 'Follow-up: no actionable feedback';
    return { ...record, activity: result, updated: new Date().toISOString() };
  });
  return result;
}
