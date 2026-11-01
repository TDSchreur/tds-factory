import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

// The Azure DevOps adapter of the PR provider seam (ADR 0020): every call of the `az` command lives here, and every call only reads.
// It needs the `azure-devops` extension of the Azure CLI and a signed-in user (`az login`). There is no merge, no Follow-up and no write operation.
const exec = promisify(execFile);
const ORG = '[A-Za-z0-9][\\w.-]{0,63}';
const NAME = '(?:[\\w.~-]|%[0-9A-Fa-f]{2}){1,128}'; // a project or repository name, percent-encoded
const PR = new RegExp(`^https://dev\\.azure\\.com/(${ORG})/(${NAME})/_git/(${NAME})/pullrequest/([1-9]\\d{0,9})$`);
const REMOTE_HTTPS = new RegExp(`^https://(?:[\\w.-]+@)?dev\\.azure\\.com/(${ORG})/(${NAME})/_git/(${NAME})/?$`);
const REMOTE_SSH = new RegExp(`^(?:ssh://)?git@ssh\\.dev\\.azure\\.com[:/]v3/(${ORG})/(${NAME})/(${NAME})$`);

export const name = 'azure-devops';
export const title = 'Azure DevOps';
// Whether a PR link is an Azure DevOps one; only such a link is ever passed to az.
const decode = (value) => { try { return decodeURIComponent(value); } catch { return undefined; } };
// A decoded name is one path segment of plain text: no slash, no control character, not a dot segment.
const plain = (value) => typeof value === 'string' && !/[\x00-\x1f\x7f\\/]/.test(value) && value !== '.' && value !== '..';
export const matches = (url) => {
  if (typeof url !== 'string' || url.length > 600) return false;
  const match = PR.exec(url);
  return !!match && plain(decode(match[2])) && plain(decode(match[3]));
};
// Organisation and project (as owner) and repository a git remote URL points at, or undefined when it is not Azure DevOps.
export function repoOfRemote(remote) {
  const match = REMOTE_HTTPS.exec(String(remote).trim()) ?? REMOTE_SSH.exec(String(remote).trim());
  if (!match) return undefined;
  const [project, repo] = [decode(match[2]), decode(match[3])];
  return plain(project) && plain(repo) ? { owner: `${match[1]}/${project}`, name: repo } : undefined;
}

const parts = (url) => {
  const match = PR.exec(url);
  return { organization: `https://dev.azure.com/${match[1]}`, project: decode(match[2]), repository: decode(match[3]), id: match[4] };
};
const bad = () => new Error('incomplete Azure DevOps PR status');
const label = (v) => String(v).slice(0, 80);

// The status of a PR for the Dashboard, from `az repos pr show` and `az repos pr policy list`; throws when they have the wrong shape.
const STATE = { active: 'open', completed: 'merged', abandoned: 'closed' };
const POLICY_STATUS = ['approved', 'rejected', 'running', 'queued', 'broken', 'notApplicable'];
export function parseStatus(pr, policies) {
  if (!pr || typeof pr !== 'object' || Array.isArray(pr) || !Array.isArray(policies)) throw bad();
  const state = STATE[pr.status];
  const reviewers = pr.reviewers ?? [];
  if (!state || !Array.isArray(reviewers) || reviewers.some((r) => !r || typeof r.vote !== 'number')) throw bad();
  const checks = [], reviewPolicies = [];
  for (const policy of policies) {
    const config = policy?.configuration;
    const kind = config?.type?.displayName;
    if (!config || typeof kind !== 'string' || !POLICY_STATUS.includes(policy.status)) throw bad();
    if (!config.isBlocking || config.isEnabled === false || policy.status === 'notApplicable') continue;
    if (/reviewers?/i.test(kind)) reviewPolicies.push(policy.status);
    else checks.push({ name: label(config.settings?.displayName ?? kind), status: policy.status });
  }
  const failing = checks.filter((c) => ['rejected', 'broken'].includes(c.status)).map((c) => c.name);
  const result = failing.length ? 'failing' : checks.some((c) => ['running', 'queued'].includes(c.status)) ? 'pending' : checks.length ? 'passing' : 'none';
  const votes = reviewers.map((r) => r.vote);
  const open = reviewPolicies.some((s) => s !== 'approved') || reviewers.some((r) => r.isRequired && r.vote === 0);
  const review = votes.some((v) => v <= -5) ? 'changes-requested' : open ? 'required' : votes.some((v) => v >= 5) ? 'approved' : 'none';
  return {
    state,
    draft: pr.isDraft === true,
    checks: { result, failing: failing.slice(0, 5) },
    merge: { succeeded: 'mergeable', conflicts: 'conflicting' }[pr.mergeStatus] ?? 'unknown',
    review,
  };
}

// Why az could not answer: az-missing, az-extension-missing, az-not-signed-in, rate-limited or error.
const failure = (err) => {
  const text = `${err.stderr ?? ''}`;
  return err.code === 'ENOENT' ? 'az-missing'
    : /misspelled or not recognized|azure-devops|extension/i.test(text) ? 'az-extension-missing'
      : /az login|AADSTS|TF400813|not authorized|401|403|credentials/i.test(text) ? 'az-not-signed-in'
        : /rate limit|429|TF400733/i.test(text) ? 'rate-limited' : 'error';
};
const args = (subcommand, { organization, id }) => ['repos', 'pr', ...subcommand, '--id', id, '--organization', organization, '--output', 'json', '--only-show-errors'];
const SHOW = ['show'], POLICIES = ['policy', 'list'];
const env = () => ({ ...process.env, AZURE_CORE_NO_COLOR: '1', AZURE_CORE_COLLECT_TELEMETRY: 'false' });
const defaultRun = (argv) => exec('az', argv, { timeout: 20_000, maxBuffer: 16 * 1024 * 1024, env: env() });
const read = async (run, target, subcommand) => JSON.parse((await run(args(subcommand, target))).stdout);
// The PR must be the one the link names: a PR id is unique in an organisation, so a link with the wrong project or repository is refused.
function belongsTo(pr, target) {
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
  if (!same(pr?.repository?.name, target.repository) || !same(pr?.repository?.project?.name, target.project)) throw new Error('the Azure DevOps PR does not belong to the repository in its link');
}

// Read from Azure DevOps without blocking the caller. `run` is the injection point for tests. A failure carries a `reason`.
export async function statusAsync(url, { run = defaultRun } = {}) {
  if (!matches(url)) throw Object.assign(new Error('not an Azure DevOps pull request'), { reason: 'error' });
  const target = parts(url);
  let pr, policies;
  try { [pr, policies] = await Promise.all([read(run, target, SHOW), read(run, target, POLICIES)]); }
  catch (err) { throw Object.assign(new Error('cannot read Azure DevOps PR status'), { reason: err instanceof SyntaxError ? 'error' : failure(err) }); }
  try { belongsTo(pr, target); return parseStatus(pr, policies); }
  catch (err) { throw Object.assign(err, { reason: 'error' }); }
}

const GIT_STATE = { active: 'OPEN', completed: 'MERGED', abandoned: 'CLOSED' };
function viewOf(pr, target) {
  belongsTo(pr, target);
  const state = GIT_STATE[pr?.status];
  if (!state) throw new Error('incomplete Azure DevOps PR state');
  return { state, headRefOid: pr.lastMergeSourceCommit?.commitId };
}
// Only the state: OPEN, MERGED or CLOSED.
export async function stateAsync(url, { run = defaultRun } = {}) {
  if (!matches(url)) throw new Error('not an Azure DevOps pull request');
  const target = parts(url);
  return viewOf(await read(run, target, SHOW), target).state;
}
// State and head commit of a PR, read without blocking the caller more than `timeout`; throws when az cannot say.
export function view(url, { cwd, timeout = 20_000, run } = {}) {
  if (!matches(url)) throw new Error('not an Azure DevOps pull request');
  const target = parts(url);
  const call = run ?? ((argv) => spawnSync('az', argv, { cwd, encoding: 'utf8', timeout, env: env() }));
  const out = call(args(SHOW, target));
  if (out.status !== 0) throw new Error((out.stderr || out.error?.message || 'az failed').trim());
  return viewOf(JSON.parse(out.stdout), target);
}
