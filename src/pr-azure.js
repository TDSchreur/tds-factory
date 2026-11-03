/** @import { PrStatus, PrView } from './pr-provider.js' */
/** @import { PrDetails } from './pr-github.js' */
/** @import { FollowUp } from './run-record.js' */
import { commandStep } from './git.js';
import { CHECKS_MAX, COMMENT_MAX, cut, link, NAME_MAX, PATH_MAX, THREADS_MAX } from './pr-text.js';
import { exec, failureText, MAX_BUFFER, reasonError, remoteText, spawnText } from './pr-exec.js';

// The Azure DevOps adapter of the PR provider seam (ADR 0020): every call of the `az` command lives here, and every call only reads.
// It needs the `azure-devops` extension of the Azure CLI and a signed-in user (`az login`). There is no merge and no write operation.
const ORG = '[A-Za-z0-9][\\w.-]{0,63}';
const NAME = '(?:[\\w.~-]|%[0-9A-Fa-f]{2}){1,128}'; // a project or repository name, percent-encoded
const PR = new RegExp(`^https://dev\\.azure\\.com/(${ORG})/(${NAME})/_git/(${NAME})/pullrequest/([1-9]\\d{0,9})$`);
const REMOTE_HTTPS = new RegExp(`^https://(?:[\\w.-]+@)?dev\\.azure\\.com/(${ORG})/(${NAME})/_git/(${NAME})/?$`);
const REMOTE_SSH = new RegExp(`^(?:ssh://)?git@ssh\\.dev\\.azure\\.com[:/]v3/(${ORG})/(${NAME})/(${NAME})$`);

export const name = 'azure-devops';
export const title = 'Azure DevOps';
// Whether a PR link is an Azure DevOps one; only such a link is ever passed to az.
/** @param {string} value */
const decode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape means the link is not one of ours; the caller treats undefined as no match.
    return undefined;
  }
};
// A decoded name is one path segment of plain text: no slash, no control character, not a dot segment.
/** @param {unknown} value @returns {value is string} */
const plain = (value) =>
  typeof value === 'string' && !/[\x00-\x1f\x7f\\/]/.test(value) && value !== '.' && value !== '..';
/** @param {unknown} url */
export const matches = (url) => {
  if (typeof url !== 'string' || url.length > 600) return false;
  const match = PR.exec(url);
  return !!match && plain(decode(match[2])) && plain(decode(match[3]));
};
// Organisation and project (as owner) and repository a git remote URL points at, or undefined when it is not Azure DevOps.
/** @param {unknown} remote */
export function repoOfRemote(remote) {
  const match = REMOTE_HTTPS.exec(remoteText(remote)) ?? REMOTE_SSH.exec(remoteText(remote));
  if (!match) return undefined;
  const [project, repo] = [decode(match[2]), decode(match[3])];
  return plain(project) && plain(repo) ? { owner: `${match[1]}/${project}`, name: repo } : undefined;
}

/**
 * @param {string} url A link that `matches` accepted.
 * @returns {Target}
 */
const parts = (url) => {
  const match = /** @type {RegExpExecArray} */ (PR.exec(url));
  return {
    organization: `https://dev.azure.com/${match[1]}`,
    project: decode(match[2]),
    projectPath: match[2],
    repository: decode(match[3]),
    id: match[4],
  };
};
/** @typedef {{ organization: string, project: string | undefined, projectPath: string, repository: string | undefined, id: string }} Target */
const bad = () => new Error('incomplete Azure DevOps PR status');
/** @param {unknown} v */
const label = (v) => String(v).slice(0, 80);

// The setup steps the user needs when az is missing, lacks the extension or is signed out (ADR 0034).
export const setup = {
  reasons: ['az-missing', 'az-extension-missing', 'az-not-signed-in'],
  steps: [
    'Install the Azure CLI',
    'Run `az extension add --name azure-devops`',
    'Run `az login`',
    'Run `az devops configure --defaults organization=<url> project=<name>`',
  ],
};
// The status of a PR for the Dashboard, from `az repos pr show` and `az repos pr policy list`; throws when they have the wrong shape.
/** @type {Record<string, PrStatus['state']>} */
const STATE = { active: 'open', completed: 'merged', abandoned: 'closed' };
/** @type {Record<string, string>} */
const MERGE = { succeeded: 'mergeable', conflicts: 'conflicting' };
const POLICY_STATUS = ['approved', 'rejected', 'running', 'queued', 'broken', 'notApplicable'];
// "Require a merge strategy" judges the strategy chosen at completion, so it is rejected until then: a setting, not a check.
// Matched by its type id, the same in every organisation, because the display name is localised.
const MERGE_STRATEGY_POLICY_TYPE_ID = 'fa4e907d-c16b-4a4c-9dfa-4916e5d171ab';
/**
 * The blocking policies that are checks (build and the like) and the status of those that are about reviewers.
 * The reviewer policies and the merge strategy policy are not checks.
 * @param {any} policies parsed JSON from the CLI, checked field by field
 * @returns {{ checks: Check[], reviewPolicies: string[] }}
 */
function policyChecks(policies) {
  if (!Array.isArray(policies)) throw bad();
  /** @type {Check[]} */
  const checks = [],
    /** @type {string[]} */
    reviewPolicies = [];
  for (const policy of policies) {
    const config = policy?.configuration;
    const kind = config?.type?.displayName;
    if (!config || typeof kind !== 'string' || !POLICY_STATUS.includes(policy.status)) throw bad();
    if (!config.isBlocking || config.isEnabled === false || policy.status === 'notApplicable') continue;
    if (config.type.id === MERGE_STRATEGY_POLICY_TYPE_ID) continue;
    if (/reviewers?/i.test(kind)) reviewPolicies.push(policy.status);
    else
      checks.push({
        name: String(config.settings?.displayName ?? kind),
        status: policy.status,
        buildId: policy.context?.buildId,
        url: null,
      });
  }
  return { checks, reviewPolicies };
}
/** @typedef {{ name: string, status: string, buildId?: unknown, url: string | null }} Check */
/**
 * @param {any} pr parsed JSON from the CLI, checked field by field
 * @param {any} policies parsed JSON from the CLI, checked field by field
 * @param {Check[]} [statuses] the PR statuses that are checks, from `statusChecks`
 * @returns {PrStatus}
 */
export function parseStatus(pr, policies, statuses = []) {
  if (!pr || typeof pr !== 'object' || Array.isArray(pr) || !Array.isArray(policies)) throw bad();
  const state = Object.hasOwn(STATE, pr.status) ? STATE[pr.status] : undefined;
  const reviewers = pr.reviewers ?? [];
  if (!state || !Array.isArray(reviewers) || reviewers.some((r) => !r || typeof r.vote !== 'number')) throw bad();
  const policy = policyChecks(policies);
  const reviewPolicies = policy.reviewPolicies;
  const checks = [...policy.checks, ...statuses].map((c) => ({ name: label(c.name), status: c.status }));
  const failing = checks.filter((c) => ['rejected', 'broken'].includes(c.status)).map((c) => c.name);
  /** @type {PrStatus['checks']['result']} */
  const result = failing.length
    ? 'failing'
    : checks.some((c) => ['running', 'queued'].includes(c.status))
      ? 'pending'
      : checks.length
        ? 'passing'
        : 'none';
  const votes = reviewers.map((r) => r.vote);
  const open = reviewPolicies.some((s) => s !== 'approved') || reviewers.some((r) => r.isRequired && r.vote === 0);
  const review = votes.some((v) => v <= -5)
    ? 'changes-requested'
    : open
      ? 'required'
      : votes.some((v) => v >= 5)
        ? 'approved'
        : 'none';
  return {
    state,
    draft: pr.isDraft === true,
    checks: { result, failing: failing.slice(0, 5) },
    merge: Object.hasOwn(MERGE, pr.mergeStatus) ? MERGE[pr.mergeStatus] : 'unknown',
    review,
  };
}

// Why az could not answer: az-missing, az-extension-missing, az-not-signed-in, rate-limited or error.
/** @param {any} err The error of a failed command: an Error with its stderr and code, as execFile gives it. */
const failure = (err) => {
  const text = `${err.stderr ?? ''}`;
  return err.code === 'ENOENT' || err.code === CMD_NOT_FOUND || /['"]az(?:\.cmd)?['"] is not recognized/i.test(text)
    ? 'az-missing'
    : /misspelled or not recognized|azure-devops|extension/i.test(text)
      ? 'az-extension-missing'
      : /az login|AADSTS|TF400813|not authorized|401|403|credentials/i.test(text)
        ? 'az-not-signed-in'
        : /rate limit|429|TF400733/i.test(text)
          ? 'rate-limited'
          : 'error';
};
/**
 * @param {string[]} subcommand
 * @param {Target} target
 */
const args = (subcommand, { organization, id }) => [
  'repos',
  'pr',
  ...subcommand,
  '--id',
  id,
  '--organization',
  organization,
  '--output',
  'json',
  '--only-show-errors',
];
const SHOW = ['show'],
  POLICIES = ['policy', 'list'];
// cmd.exe reports a command it cannot find with exit code 9009 in every language.
const CMD_NOT_FOUND = 9009;
// What may reach cmd.exe unquoted: the fixed flags, the validated organisation URL, the numeric id and `name=value` of route parameters (values are GUIDs and the numeric id).
const SAFE_ARG = /^[\w.:/=-]+$/;
/**
 * How to start az: on Windows `az` is the batch file az.cmd, which Node cannot start itself, so it goes through cmd.exe.
 * @param {string[]} argv
 * @param {string} [platform]
 * @returns {[string, string[], { env: NodeJS.ProcessEnv, windowsVerbatimArguments: boolean }]}
 */
export function launch(argv, platform = process.platform) {
  const env = { ...process.env, AZURE_CORE_NO_COLOR: '1', AZURE_CORE_COLLECT_TELEMETRY: 'false' };
  if (platform !== 'win32') return ['az', argv, { env, windowsVerbatimArguments: false }];
  // The arguments are joined unquoted, so refuse anything that cmd.exe could read as more than a plain word.
  if (!argv.every((arg) => SAFE_ARG.test(arg))) throw new Error('refusing to pass an unsafe argument to cmd.exe');
  return [
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `az.cmd ${argv.join(' ')}`],
    // Do not let cmd.exe pick up an az.cmd from the current directory (a project worktree).
    { env: { ...env, NoDefaultCurrentDirectoryInExePath: '1' }, windowsVerbatimArguments: true },
  ];
}
/** @param {string[]} argv */
const defaultRun = (argv) => {
  const [file, launched, options] = launch(argv);
  return exec(file, launched, { timeout: 20_000, maxBuffer: MAX_BUFFER, ...options });
};
/**
 * @param {(argv: string[]) => Promise<{ stdout: string }>} run
 * @param {Target} target
 * @param {string[]} subcommand
 */
const read = async (run, target, subcommand) => JSON.parse((await run(args(subcommand, target))).stdout);
// The PR must be the one the link names: a PR id is unique in an organisation, so a link with the wrong project or repository is refused.
/**
 * @param {any} pr parsed JSON from the CLI, checked field by field
 * @param {Target} target
 */
function belongsTo(pr, target) {
  /** @param {unknown} a @param {unknown} b */
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
  if (!same(pr?.repository?.name, target.repository) || !same(pr?.repository?.project?.name, target.project))
    throw new Error('the Azure DevOps PR does not belong to the repository in its link');
}

/**
 * The PR and its policies, read together and checked to be the PR the link names.
 * @param {(argv: string[]) => Promise<{ stdout: string }>} run
 * @param {Target} target
 * @param {string} what
 */
async function readPr(run, target, what) {
  /** @type {any} */
  let pr, policies;
  try {
    [pr, policies] = await Promise.all([read(run, target, SHOW), read(run, target, POLICIES)]);
  } catch (err) {
    throw reasonError(`cannot read Azure DevOps PR ${what}`, err instanceof SyntaxError ? 'error' : failure(err), err);
  }
  try {
    belongsTo(pr, target);
  } catch (err) {
    throw err instanceof Error ? reasonError(err.message, 'error', err) : err;
  }
  return { pr, policies };
}
// Read from Azure DevOps without blocking the caller. `run` is the injection point for tests. A failure is a FactoryError with a `code`.
/**
 * @param {string} url
 * @param {{ run?: (argv: string[]) => Promise<{ stdout: string }> }} [options]
 * @returns {Promise<PrStatus>}
 */
export async function statusAsync(url, { run = defaultRun } = {}) {
  if (!matches(url)) throw reasonError('not an Azure DevOps pull request', 'error');
  const target = parts(url);
  const { pr, policies } = await readPr(run, target, 'status');
  try {
    const status = parseStatus(pr, policies);
    if (status.state !== 'open') return status;
    const statuses = statusChecks(await readInvoke(run, target, ids(pr), STATUSES, 'status'));
    return parseStatus(pr, policies, statuses);
  } catch (err) {
    throw err instanceof Error && !('code' in err) ? reasonError(err.message, 'error', err) : err;
  }
}

/** @type {Record<string, PrView['state']>} */
const GIT_STATE = { active: 'OPEN', completed: 'MERGED', abandoned: 'CLOSED' };
/**
 * @param {any} pr parsed JSON from the CLI, checked field by field
 * @param {Target} target
 * @returns {PrView}
 */
function viewOf(pr, target) {
  belongsTo(pr, target);
  const state = Object.hasOwn(GIT_STATE, pr?.status) ? GIT_STATE[pr.status] : undefined;
  if (!state) throw new Error('incomplete Azure DevOps PR state');
  return { state, headRefOid: pr.lastMergeSourceCommit?.commitId };
}
// Only the state: OPEN, MERGED or CLOSED.
/**
 * @param {string} url
 * @param {{ run?: (argv: string[]) => Promise<{ stdout: string }> }} [options]
 * @returns {Promise<string>}
 */
export async function stateAsync(url, { run = defaultRun } = {}) {
  return (await viewAsync(url, { run })).state;
}
// State and head commit, read without blocking the caller. `run` is the injection point for tests.
/**
 * @param {string} url
 * @param {{ run?: (argv: string[]) => Promise<{ stdout: string }> }} [options]
 * @returns {Promise<PrView>}
 */
export async function viewAsync(url, { run = defaultRun } = {}) {
  if (!matches(url)) throw new Error('not an Azure DevOps pull request');
  const target = parts(url);
  return viewOf(await read(run, target, SHOW), target);
}
// State and head commit of a PR, read without blocking the caller more than `timeout`; throws when az cannot say.
/**
 * @param {string} url
 * @param {{ cwd?: string, timeout?: number, run?: (argv: string[]) => { status: number | null, stdout: string, stderr: string, error?: Error } }} [options]
 * @returns {PrView}
 */
export function view(url, { cwd, timeout = 20_000, run } = {}) {
  if (!matches(url)) throw new Error('not an Azure DevOps pull request');
  const target = parts(url);
  const call =
    run ??
    ((argv) => {
      const [file, launched, options] = launch(argv);
      return spawnText(file, launched, { cwd, timeout, ...options });
    });
  const out = call(args(SHOW, target));
  if (out.status !== 0) throw new Error(failureText(out, 'az failed'));
  return viewOf(JSON.parse(out.stdout), target);
}

// What Check PR shows for Azure DevOps (ADR 0034): the same as for GitHub, from the PR, its policies, its threads and its statuses.
// Every text comes from Azure DevOps and is untrusted: see src/pr-text.js.
/**
 * @param {string} url
 * @param {{ run?: (argv: string[]) => Promise<{ stdout: string }> }} [options]
 * @returns {Promise<PrDetails>}
 */
export async function details(url, { run = defaultRun } = {}) {
  if (!matches(url)) throw reasonError('not an Azure DevOps pull request', 'error');
  const target = parts(url);
  const { pr, policies } = await readPr(run, target, 'details');
  try {
    const status = parseStatus(pr, policies);
    if (status.state !== 'open') return { state: status.state };
    const guids = ids(pr);
    const [threadsAnswer, statusesAnswer] = await Promise.all([
      readInvoke(run, target, guids, THREADS, 'details'),
      readInvoke(run, target, guids, STATUSES, 'details'),
    ]);
    const entries = checkEntries(target, policies, statusesAnswer);
    const failing = entries.filter((c) => FAILING.includes(c.status));
    const pending = entries.filter((c) => PENDING.includes(c.status));
    const unresolved = openThreads(threadsAnswer).map((t) => ({
      path: cut(t.path, PATH_MAX),
      comment: cut(t.comments[0].content, COMMENT_MAX),
      url: t.link(url),
    }));
    return {
      state: status.state,
      draft: status.draft,
      conflicts: status.merge === 'conflicting' ? true : status.merge === 'mergeable' ? false : null,
      failing: failing.slice(0, CHECKS_MAX).map((c) => ({ name: cut(c.name, NAME_MAX), url: c.url })),
      failingTotal: failing.length,
      pending: pending.slice(0, CHECKS_MAX).map((c) => cut(c.name, NAME_MAX)),
      pendingTotal: pending.length,
      threads: unresolved.slice(0, THREADS_MAX),
      threadsTotal: unresolved.length,
    };
  } catch (err) {
    throw err instanceof Error && !('code' in err) ? reasonError(err.message, 'error', err) : err;
  }
}

const FAILING = ['rejected', 'broken'],
  PENDING = ['running', 'queued'];
const THREADS = 'pullRequestThreads',
  STATUSES = 'pullRequestStatuses';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The GUIDs of the project and the repository, from the PR itself: what reaches the command line is never a name decoded from the link.
/** @param {any} pr */
function ids(pr) {
  const project = pr?.repository?.project?.id,
    repository = pr?.repository?.id;
  if (typeof project !== 'string' || typeof repository !== 'string' || !GUID.test(project) || !GUID.test(repository))
    throw new Error('incomplete Azure DevOps PR: no project or repository id');
  return { project, repository };
}
/**
 * One read-only call of `az devops invoke`: only GET, only these two resources.
 * @param {Target} target
 * @param {{ project: string, repository: string }} guids
 * @param {string} resource
 */
const invokeArgs = ({ organization, id }, { project, repository }, resource) => [
  'devops',
  'invoke',
  '--area',
  'git',
  '--resource',
  resource,
  '--route-parameters',
  `project=${project}`,
  `repositoryId=${repository}`,
  `pullRequestId=${id}`,
  '--api-version',
  '7.1',
  '--organization',
  organization,
  '--output',
  'json',
  '--only-show-errors',
];
/**
 * @param {(argv: string[]) => Promise<{ stdout: string }>} run
 * @param {Target} target
 * @param {{ project: string, repository: string }} guids
 * @param {string} resource
 * @param {string} what
 * @returns {Promise<any[]>} the `value` list of the answer
 */
async function readInvoke(run, target, guids, resource, what) {
  /** @type {any} */
  let answer;
  try {
    answer = JSON.parse((await run(invokeArgs(target, guids, resource))).stdout);
  } catch (err) {
    throw reasonError(`cannot read Azure DevOps PR ${what}`, err instanceof SyntaxError ? 'error' : failure(err), err);
  }
  if (!answer || typeof answer !== 'object' || !Array.isArray(answer.value))
    throw reasonError(`incomplete Azure DevOps ${resource}`, 'error');
  return answer.value;
}
// A PR status is a check when its latest post for the context is pending, failed or in error; the others are none.
/** @type {Record<string, string>} */
const STATUS_CHECK = { pending: 'running', failed: 'rejected', error: 'rejected' };
/**
 * @param {any[]} statuses the `value` of the pullRequestStatuses answer
 * @returns {Check[]}
 */
function statusChecks(statuses) {
  /** @type {Map<string, any>} */
  const latest = new Map();
  /** @param {any} s */
  const time = (s) => Date.parse(s.updatedDate ?? s.creationDate) || 0;
  for (const s of statuses) {
    if (!s || typeof s.state !== 'string' || typeof s.context?.name !== 'string' || typeof s.id !== 'number')
      throw new Error('incomplete Azure DevOps pullRequestStatuses');
    const key = JSON.stringify([s.context.genre ?? '', s.context.name]);
    const old = latest.get(key);
    if (!old || time(s) > time(old) || (time(s) === time(old) && s.id > old.id)) latest.set(key, s);
  }
  return [...latest.values()]
    .filter((s) => Object.hasOwn(STATUS_CHECK, s.state))
    .map((s) => ({
      name:
        typeof s.context.genre === 'string' && s.context.genre
          ? `${s.context.genre}/${s.context.name}`
          : s.context.name,
      status: STATUS_CHECK[s.state],
      url: link(s.targetUrl),
    }));
}
// The link of a build policy: the organisation and project of the PR link and the build id as an integer; nothing comes from free text.
/** @param {Target} target @param {unknown} buildId */
function buildLink({ organization, projectPath }, buildId) {
  return typeof buildId === 'number' && Number.isSafeInteger(buildId) && buildId > 0
    ? `${organization}/${projectPath}/_build/results?buildId=${buildId}`
    : null;
}
// Policy and status checks together, each with its link: a build policy's from the PR link and the build id, a status's own `targetUrl`.
/**
 * @param {Target} target
 * @param {any} policies parsed JSON from the CLI, checked field by field
 * @param {any[]} statuses the `value` of the pullRequestStatuses answer
 */
const checkEntries = (target, policies, statuses) =>
  [...policyChecks(policies).checks, ...statusChecks(statuses)].map((c) => ({
    ...c,
    url: c.url ?? buildLink(target, c.buildId),
  }));
// Threads a person left open: active or pending, not deleted, not made by Azure DevOps itself (vote, push, policy update) and with a comment that is not deleted.
// The comments are the ones that are not deleted, with the text as Azure DevOps sent it (untrusted); `link` is the thread's link under the PR link.
/**
 * @param {any[]} threads the `value` of the pullRequestThreads answer
 */
function openThreads(threads) {
  /** @type {{ id: unknown, path: unknown, comments: { content: unknown, commentType: unknown }[], link: (url: string) => string | null }[]} */
  const list = [];
  for (const t of threads) {
    if (!t || typeof t !== 'object' || !Array.isArray(t.comments))
      throw new Error('incomplete Azure DevOps pullRequestThreads');
    if (t.isDeleted === true || !['active', 'pending'].includes(t.status)) continue;
    if (t.properties && typeof t.properties === 'object' && Object.hasOwn(t.properties, 'CodeReviewThreadType'))
      continue;
    const comments = t.comments.filter(/** @param {any} c */ (c) => c && typeof c === 'object' && c.isDeleted !== true);
    if (!comments.some(/** @param {any} c */ (c) => c.commentType !== 'system')) continue;
    list.push({
      id: t.id,
      path: t.threadContext?.filePath,
      comments,
      link: (url) => (Number.isSafeInteger(t.id) && t.id > 0 ? link(`${url}?discussionId=${t.id}`) : null),
    });
  }
  return list;
}

// Follow-up (ADR 0034): the same flows as GitHub's, so the Run, the Dashboard Fix and `run follow-up` work for Azure DevOps. All reads, as a flow of steps.
/**
 * @param {string[]} argv
 * @param {string | undefined} cwd
 * @param {string} what
 * @returns {Generator<import('./git.js').Step, any, any>} the parsed JSON of az; its shape is checked by each caller
 */
function* azFlow(argv, cwd, what) {
  const [file, launched, options] = launch(argv);
  const out = yield* commandStep(file, cwd, launched, { timeout: 20_000, maxBuffer: MAX_BUFFER, ...options });
  if (out.status !== 0)
    throw reasonError(
      `cannot read Azure DevOps PR ${what}: ${failureText(out, 'az failed')}`,
      failure({ stderr: out.stderr, code: /** @type {any} */ (out.error)?.code ?? out.status }),
      out.error,
    );
  try {
    return JSON.parse(out.stdout);
  } catch (err) {
    throw reasonError('malformed Azure DevOps response', 'error', err);
  }
}
/**
 * The PR as `az repos pr show` has it, checked to be the one the link names.
 * @param {string} url
 * @param {string | undefined} cwd
 * @param {string} what
 */
function* showFlow(url, cwd, what) {
  if (!matches(url)) throw new Error('not an Azure DevOps pull request');
  const target = parts(url);
  const pr = yield* azFlow(args(SHOW, target), cwd, what);
  belongsTo(pr, target);
  return { target, pr };
}
// State and head commit of a PR for Follow-up; the head must look like a commit id.
/**
 * @param {string} url
 * @param {string} [cwd]
 * @returns {Generator<import('./git.js').Step, PrView & { headRefOid: string }, any>}
 */
export function* strictViewFlow(url, cwd) {
  const { target, pr } = yield* showFlow(url, cwd, 'state');
  const current = viewOf(pr, target);
  if (typeof current.headRefOid !== 'string' || !/^[a-f0-9]{40,64}$/i.test(current.headRefOid))
    throw new Error('incomplete Azure DevOps PR state');
  return { ...current, headRefOid: current.headRefOid };
}
// What Follow-up observes at the PR head (`lastMergeSourceCommit`): merge conflicts, current checks and unresolved review threads.
// `mergeStatus` other than `conflicts` is no finding. The comments are untrusted text.
/**
 * @param {string} url
 * @param {string} head
 * @param {string} [cwd]
 * @returns {Generator<import('./git.js').Step, FollowUp, any>}
 */
export function* observeFlow(url, head, cwd) {
  const { target, pr } = yield* showFlow(url, cwd, 'follow-up');
  if (pr.lastMergeSourceCommit?.commitId !== head) throw new Error('Azure DevOps PR head changed during Follow-up');
  const policies = yield* azFlow(args(POLICIES, target), cwd, 'follow-up');
  if (!Array.isArray(policies)) throw bad();
  const guids = ids(pr);
  /** @param {string} resource */
  const value = function* (resource) {
    const answer = yield* azFlow(invokeArgs(target, guids, resource), cwd, 'follow-up');
    if (!answer || typeof answer !== 'object' || !Array.isArray(answer.value))
      throw reasonError(`incomplete Azure DevOps ${resource}`, 'error');
    return answer.value;
  };
  const statuses = yield* value(STATUSES);
  const threadsAnswer = yield* value(THREADS);
  const checks = checkEntries(target, policies, statuses).map((c) => ({
    name: c.name,
    state: c.status,
    url: link(c.url),
    description: null,
    failing: FAILING.includes(c.status),
    pending: PENDING.includes(c.status),
  }));
  const threads = openThreads(threadsAnswer).map((t) => {
    if (!Number.isSafeInteger(t.id)) throw new Error('incomplete Azure DevOps review thread');
    const href = /** @type {string} */ (t.link(url));
    const comments = t.comments
      .filter((c) => c.commentType !== 'system')
      .map((c) => {
        if (typeof c.content !== 'string') throw new Error('incomplete Azure DevOps review comment');
        return { body: c.content, url: href };
      });
    return { id: String(t.id), path: typeof t.path === 'string' ? t.path : '', comments };
  });
  return {
    pr: url,
    head,
    observed: new Date().toISOString(),
    conflicts: pr.mergeStatus === 'conflicts',
    checks,
    failures: checks.filter((c) => c.failing),
    pending: checks.some((c) => c.pending),
    threads,
  };
}
