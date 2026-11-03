/** @import { PrStatus, PrView } from './pr-provider.js' */
/** @import { FollowUp, Check } from './run-record.js' */
import { exec, failureText, MAX_BUFFER, reasonError, remoteText, spawnText } from './pr-exec.js';

// The GitHub adapter of the PR provider seam (see ADR 0020): every call of the `gh` command lives here.
const PR = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/;

export const name = 'github';
export const title = 'GitHub';
// Whether a PR link is a GitHub one; only such a link is ever passed to gh.
/** @param {unknown} url */
export const matches = (url) => typeof url === 'string' && PR.test(url);
// The repository (owner and name) a git remote URL points at, or undefined when it is not GitHub.
/** @param {unknown} remote */
export function repoOfRemote(remote) {
  const match =
    /^(?:https?:\/\/github\.com\/|ssh:\/\/(?:git@)?github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i.exec(
      remoteText(remote),
    );
  return match ? { owner: match[1], name: match[2] } : undefined;
}

// GitHub content is data: pass only validated identifiers as arguments, never shell text.
/**
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {any} The parsed JSON of gh; its shape is checked by each caller.
 */
function gh(args, cwd) {
  const out = spawnText('gh', args, {
    cwd,
    timeout: 20000,
    maxBuffer: MAX_BUFFER,
    env: { ...process.env, GH_PROMPT_DISABLED: '1' },
  });
  if (out.status !== 0) throw new Error(`cannot read GitHub PR: ${failureText(out, 'gh failed')}`);
  try {
    return JSON.parse(out.stdout);
  } catch (err) {
    throw reasonError('malformed GitHub response', 'error', err);
  }
}
const checksQuery = `query FollowUpChecks($owner:String!, $repo:String!, $number:Int!, $cursor:String) { repository(owner:$owner,name:$repo) { pullRequest(number:$number) { headRefOid mergeable commits(last:1) { nodes { commit { statusCheckRollup { contexts(first:100,after:$cursor) { nodes { __typename ... on CheckRun { name status conclusion detailsUrl } ... on StatusContext { context state targetUrl description } } pageInfo { hasNextPage endCursor } } } } } } } } }`;
const threadsQuery = `query FollowUpThreads($owner:String!, $repo:String!, $number:Int!, $cursor:String) { repository(owner:$owner,name:$repo) { pullRequest(number:$number) { headRefOid reviewThreads(first:100,after:$cursor) { nodes { id isResolved path comments(first:100) { nodes { body url } pageInfo { hasNextPage endCursor } } } pageInfo { hasNextPage endCursor } } } } }`;
const commentsQuery = `query FollowUpComments($thread:ID!, $cursor:String) { node(id:$thread) { ... on PullRequestReviewThread { id comments(first:100,after:$cursor) { nodes { body url } pageInfo { hasNextPage endCursor } } } } }`;
/**
 * @param {string} query
 * @param {Record<string, string>} fields
 * @param {string | undefined} cwd
 * @param {string} [cursor]
 * @returns {any} The data of the GraphQL response; its shape is checked by each caller.
 */
function graph(query, fields, cwd, cursor) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(fields)) args.push(key === 'number' ? '-F' : '-f', `${key}=${value}`);
  if (cursor) args.push('-f', `cursor=${cursor}`);
  const response = gh(args, cwd);
  if (!response || typeof response !== 'object' || response.errors || !response.data)
    throw new Error('incomplete GitHub response');
  return response.data;
}
/**
 * The nodes of every page of a GraphQL connection. Its data is parsed JSON, checked field by field by the callers.
 * @param {(cursor?: string) => any} fetch
 * @param {(data: any) => any} select
 * @returns {any[]}
 */
function pages(fetch, select) {
  /** @type {any[]} Parsed JSON, checked by the callers. */
  const all = [],
    seen = new Set();
  /** @type {string | undefined} */
  let cursor;
  while (true) {
    const connection = select(fetch(cursor));
    if (
      !connection ||
      !Array.isArray(connection.nodes) ||
      !connection.pageInfo ||
      typeof connection.pageInfo.hasNextPage !== 'boolean'
    )
      throw new Error('incomplete GitHub pagination');
    all.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return all;
    const next = connection.pageInfo.endCursor;
    if (typeof next !== 'string' || !next || seen.has(next) || seen.size >= 1000)
      throw new Error('incomplete GitHub pagination');
    seen.add(next);
    cursor = next;
  }
}
/** @param {any} comment Parsed JSON from gh, checked field by field. */
function validComment(comment) {
  if (!comment || typeof comment.body !== 'string' || typeof comment.url !== 'string' || !comment.url)
    throw new Error('incomplete GitHub review comment');
  return { body: comment.body, url: comment.url };
}
/**
 * @param {any} check parsed JSON from the CLI, checked field by field
 * @returns {Check}
 */
function checkState(check) {
  if (!check || !['CheckRun', 'StatusContext'].includes(check.__typename)) throw new Error('unknown GitHub check');
  if (check.__typename === 'StatusContext') {
    if (
      typeof check.context !== 'string' ||
      !check.context ||
      !['ERROR', 'FAILURE', 'PENDING', 'EXPECTED', 'SUCCESS'].includes(check.state)
    )
      throw new Error('incomplete GitHub status');
    return {
      name: check.context,
      state: check.state,
      url: check.targetUrl ?? null,
      description: check.description ?? null,
      failing: ['ERROR', 'FAILURE'].includes(check.state),
      pending: ['PENDING', 'EXPECTED'].includes(check.state),
    };
  }
  if (
    typeof check.name !== 'string' ||
    !check.name ||
    !['COMPLETED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'PENDING'].includes(check.status)
  )
    throw new Error('incomplete GitHub check run');
  const failures = ['ACTION_REQUIRED', 'CANCELLED', 'FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'STALE'];
  if (check.status === 'COMPLETED' && ![...failures, 'SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(check.conclusion))
    throw new Error('incomplete GitHub check conclusion');
  return {
    name: check.name,
    state: check.status,
    conclusion: check.conclusion ?? null,
    url: check.detailsUrl ?? null,
    failing: check.status === 'COMPLETED' && failures.includes(check.conclusion),
    pending: check.status !== 'COMPLETED',
  };
}
// State and head of a PR for Follow-up: strict, and throws when GitHub cannot say.
/**
 * @param {string} url
 * @param {string} [cwd]
 * @returns {PrView & { headRefOid: string }}
 */
export function strictView(url, cwd) {
  const value = gh(['pr', 'view', url, '--json', 'state,headRefOid'], cwd);
  if (
    !value ||
    !['OPEN', 'CLOSED', 'MERGED'].includes(value.state) ||
    typeof value.headRefOid !== 'string' ||
    !/^[a-f0-9]{40,64}$/i.test(value.headRefOid)
  )
    throw new Error('incomplete GitHub PR state');
  return value;
}
// What Follow-up observes at the PR head: merge conflicts, current checks and unresolved review threads.
// GitHub computes `mergeable` lazily; UNKNOWN is no finding, the next Follow-up reads it again.
/**
 * @param {string} url
 * @param {string} head
 * @param {string} [cwd]
 * @returns {FollowUp}
 */
export function observe(url, head, cwd) {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/.exec(url);
  if (!match || !Number.isSafeInteger(Number(match[3])) || Number(match[3]) < 1)
    throw new Error('Follow-up needs a GitHub PR URL');
  const fields = { owner: match[1], repo: match[2], number: match[3] };
  /** @param {any} data Parsed JSON from gh, checked field by field. */
  const pr = (data) => {
    const value = data.repository?.pullRequest;
    if (!value || value.headRefOid !== head) throw new Error('GitHub PR head changed during Follow-up');
    return value;
  };
  /** @type {unknown} */
  let mergeable;
  const checks = pages(
    (cursor) => graph(checksQuery, fields, cwd, cursor),
    (data) => {
      const value = pr(data);
      mergeable ??= value.mergeable;
      const commits = value.commits?.nodes;
      if (
        !Array.isArray(commits) ||
        commits.length !== 1 ||
        !commits[0]?.commit ||
        !Object.hasOwn(commits[0].commit, 'statusCheckRollup')
      )
        throw new Error('incomplete GitHub checks');
      const rollup = commits[0].commit.statusCheckRollup;
      return rollup === null ? { nodes: [], pageInfo: { hasNextPage: false } } : rollup?.contexts;
    },
  ).map(checkState);
  if (!['MERGEABLE', 'CONFLICTING', 'UNKNOWN'].includes(String(mergeable)))
    throw new Error('incomplete GitHub merge state');
  const rawThreads = pages(
    (cursor) => graph(threadsQuery, fields, cwd, cursor),
    (data) => pr(data).reviewThreads,
  );
  /** @type {FollowUp['threads']} */
  const threads = [];
  for (const thread of rawThreads) {
    if (
      !thread ||
      typeof thread.id !== 'string' ||
      !thread.id ||
      typeof thread.isResolved !== 'boolean' ||
      typeof thread.path !== 'string'
    )
      throw new Error('incomplete GitHub review thread');
    if (thread.isResolved) continue;
    let first = true;
    const comments = pages(
      (cursor) => {
        if (first) {
          first = false;
          return thread.comments;
        }
        return graph(commentsQuery, { thread: thread.id }, cwd, cursor).node;
      },
      (value) => (value === thread.comments ? value : value?.id === thread.id ? value.comments : null),
    ).map(validComment);
    if (!comments.length) throw new Error('incomplete GitHub review thread');
    threads.push({ id: thread.id, path: thread.path, comments });
  }
  return {
    pr: url,
    head,
    observed: new Date().toISOString(),
    conflicts: mergeable === 'CONFLICTING',
    checks,
    failures: checks.filter((c) => c.failing),
    pending: checks.some((c) => c.pending),
    threads,
  };
}

const VIEW_ARGS = ['pr', 'view'];
// The state and head `gh pr view --json state,headRefOid` printed; the sync and async variants share it.
/** @param {string} stdout @returns {PrView} */
const parseView = (stdout) => JSON.parse(stdout);
// State and head of a PR, read without blocking the caller more than `timeout`; throws when gh cannot say.
/**
 * @param {string} url
 * @param {{ cwd?: string, timeout?: number }} [options]
 * @returns {PrView}
 */
export function view(url, { cwd, timeout = 10000 } = {}) {
  const out = spawnText('gh', [...VIEW_ARGS, url, '--json', 'state,headRefOid'], { cwd, timeout });
  if (out.status !== 0) throw new Error(failureText(out, 'gh failed'));
  return parseView(out.stdout);
}
// The same, for a server that must not block: resolves to the parsed { state, headRefOid }. `run` is the injection point for tests.
/**
 * @param {string} url
 * @param {{ run?: (args: string[]) => Promise<{ stdout: string }> }} [options]
 * @returns {Promise<PrView>}
 */
export const viewAsync = async (
  url,
  { run = (args) => exec('gh', args, { timeout: 10_000, maxBuffer: MAX_BUFFER }) } = {},
) => parseView((await run([...VIEW_ARGS, url, '--json', 'state,headRefOid'])).stdout);
// Only the state: OPEN, MERGED or CLOSED.
/** @param {string} url @returns {Promise<string>} */
export const stateAsync = async (url) =>
  JSON.parse((await exec('gh', ['pr', 'view', url, '--json', 'state'], { timeout: 10_000 })).stdout).state;
// A one-line summary of the PR's checks.
/** @param {string} url */
export async function checksSummary(url) {
  /** @type {string} */
  let stdout;
  try {
    ({ stdout } = await exec('gh', ['pr', 'checks', url, '--json', 'name,bucket,state'], { timeout: 10_000 }));
  } catch (err) {
    const out = err instanceof Error && 'stdout' in err ? err.stdout : undefined;
    if (typeof out !== 'string' || !out) throw err;
    stdout = out;
  }
  const checks = JSON.parse(stdout);
  if (
    !Array.isArray(checks) ||
    checks.some(
      (c) => !c || typeof c.name !== 'string' || !['pass', 'fail', 'pending', 'skipping', 'cancel'].includes(c.bucket),
    )
  )
    throw new Error('invalid check data');
  const problems = checks
    .filter((c) => ['fail', 'pending', 'cancel'].includes(c.bucket))
    .map((c) => `${c.name}: ${c.bucket === 'fail' ? 'failing' : c.bucket === 'cancel' ? 'cancelled' : 'pending'}`);
  return problems.length
    ? `GitHub checks: ${problems.join('; ')}`
    : checks.length
      ? 'GitHub checks: passing'
      : 'GitHub checks: none reported';
}
// The PRs whose head branch is `branch` in `repo` (owner/name), validated; throws when gh cannot say.
/**
 * @param {string} repo
 * @param {string} branch
 * @param {string} [cwd]
 * @returns {{ url: string, headRefName: string, headRepository: { name: string }, headRepositoryOwner: { login: string } }[]}
 */
export function listByHead(repo, branch, cwd) {
  const out = spawnText(
    'gh',
    [
      'pr',
      'list',
      '--repo',
      repo,
      '--head',
      branch,
      '--state',
      'all',
      '--json',
      'url,headRefName,headRepository,headRepositoryOwner',
    ],
    { cwd, timeout: 10000 },
  );
  if (out.status !== 0) throw new Error(out.error?.message || out.stderr.trim() || 'GitHub lookup failed');
  const all = JSON.parse(out.stdout);
  if (
    !Array.isArray(all) ||
    all.some(
      (pr) =>
        !pr ||
        typeof pr.url !== 'string' ||
        typeof pr.headRefName !== 'string' ||
        typeof pr.headRepositoryOwner?.login !== 'string' ||
        typeof pr.headRepository?.name !== 'string',
    )
  )
    throw new Error('incomplete GitHub PR response');
  return all;
}

// The status of a PR for the Dashboard: checks, merge conflicts, review state and draft, from one `gh pr view` call.
const FAILED = ['ACTION_REQUIRED', 'CANCELLED', 'FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'STALE'];
const bad = () => new Error('incomplete GitHub PR status');
/** @param {unknown} v */
const label = (v) => String(v).slice(0, 80);

// One entry of statusCheckRollup: { name, failing, pending }.
/** @param {any} c Parsed JSON from gh, checked field by field. */
function rollupEntry(c) {
  if (!c || typeof c !== 'object') throw bad();
  if (c.__typename === 'StatusContext') {
    if (
      typeof c.context !== 'string' ||
      !c.context ||
      !['ERROR', 'FAILURE', 'PENDING', 'EXPECTED', 'SUCCESS'].includes(c.state)
    )
      throw bad();
    return {
      name: label(c.context),
      failing: ['ERROR', 'FAILURE'].includes(c.state),
      pending: ['PENDING', 'EXPECTED'].includes(c.state),
    };
  }
  if (c.__typename === 'CheckRun') {
    if (typeof c.name !== 'string' || !c.name || typeof c.status !== 'string') throw bad();
    return {
      name: label(c.name),
      failing: c.status === 'COMPLETED' && FAILED.includes(c.conclusion),
      pending: c.status !== 'COMPLETED',
    };
  }
  throw bad();
}

// Parses the JSON of `gh pr view --json state,mergeable,reviewDecision,statusCheckRollup,isDraft`; throws when it has the wrong shape.
/**
 * @param {any} value parsed JSON from the CLI, checked field by field
 * @returns {PrStatus}
 */
export function parseStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad();
  const state = /** @type {Record<string, PrStatus['state']>} */ ({ OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' })[
    value.state
  ];
  const rollup = value.statusCheckRollup ?? [];
  if (!state || !Array.isArray(rollup)) throw bad();
  const entries = rollup.map(rollupEntry);
  const failing = entries.filter((e) => e.failing).map((e) => e.name);
  /** @type {PrStatus['checks']['result']} */
  const result = failing.length
    ? 'failing'
    : entries.some((e) => e.pending)
      ? 'pending'
      : entries.length
        ? 'passing'
        : 'none';
  return {
    state,
    draft: value.isDraft === true,
    checks: { result, failing: failing.slice(0, 5) },
    merge:
      /** @type {Record<string, string>} */ ({ MERGEABLE: 'mergeable', CONFLICTING: 'conflicting' })[value.mergeable] ??
      'unknown',
    review:
      /** @type {Record<string, string>} */ ({
        APPROVED: 'approved',
        CHANGES_REQUESTED: 'changes-requested',
        REVIEW_REQUIRED: 'required',
      })[value.reviewDecision] ?? 'none',
  };
}

/** @param {any} err The error of a failed command: an Error with its stderr and code, as execFile gives it. */
const failure = (err) =>
  /rate limit/i.test(`${err.stderr ?? ''}`)
    ? 'rate-limited'
    : err.code === 'ENOENT'
      ? 'gh-missing'
      : /auth|log ?in|GH_TOKEN/i.test(`${err.stderr ?? ''}`)
        ? 'not-signed-in'
        : 'error';

// The same, read from GitHub without blocking the caller. `run` is the injection point for tests. A failure is a FactoryError whose `code` is one of:
// gh-missing, not-signed-in, rate-limited or error.
/**
 * @param {string} url
 * @param {{ run?: (args: string[]) => Promise<{ stdout: string }> }} [options]
 * @returns {Promise<PrStatus>}
 */
export async function statusAsync(
  url,
  { run = (args) => exec('gh', args, { timeout: 10_000, env: { ...process.env, GH_PROMPT_DISABLED: '1' } }) } = {},
) {
  if (!matches(url)) throw reasonError('not a GitHub pull request', 'error');
  /** @type {string} */
  let stdout;
  try {
    ({ stdout } = await run(['pr', 'view', url, '--json', 'state,mergeable,reviewDecision,statusCheckRollup,isDraft']));
  } catch (err) {
    throw reasonError('cannot read GitHub PR status', failure(err), err);
  }
  try {
    return parseStatus(JSON.parse(stdout));
  } catch (err) {
    throw reasonError('malformed GitHub PR status', 'error', err);
  }
}
