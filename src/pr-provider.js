// @ts-check
import * as github from './pr-github.js';
import * as azure from './pr-azure.js';

// The PR provider seam (ADR 0020): the rest of the Factory asks this module about a PR link and never calls a hosting CLI itself.
// An adapter exports `name`, `title`, `matches(url)`, `repoOfRemote(remote)` and the operations its callers use. GitHub (the `gh` command) has all of them;
// Azure DevOps (the `az` command) reads status, state, head, details and Follow-up observations, and has no write operation. A caller asks `can(url, operation)` before it uses an operation not every adapter has.

/**
 * The status of a PR for the Dashboard.
 * @typedef {object} PrStatus
 * @property {'open' | 'merged' | 'closed'} state
 * @property {boolean} draft
 * @property {{ result: 'failing' | 'pending' | 'passing' | 'none', failing: string[] }} checks
 * @property {string} merge
 * @property {string} review
 */
/** @typedef {{ state: 'OPEN' | 'CLOSED' | 'MERGED', headRefOid?: string }} PrView */

/**
 * What every adapter has, and the operations only some have. A caller asks `can(url, operation)` or `providerWith` before it uses an optional one.
 * @typedef {object} PrProvider
 * @property {string} name
 * @property {string} title
 * @property {(url: unknown) => boolean} matches
 * @property {(remote: unknown) => { owner: string, name: string } | undefined} repoOfRemote
 * @property {(url: string, options?: { run?: any }) => Promise<PrStatus>} statusAsync The injected `run` is a test seam for the command runner of each adapter.
 * @property {(url: string, options?: { run?: any }) => Promise<string>} stateAsync
 * @property {(url: string, options?: { cwd?: string, timeout?: number, run?: any }) => PrView} view
 * @property {(url: string, options?: { run?: any }) => Promise<PrView>} [viewAsync] `run` is the adapter's own test seam, like the other `run` options above.
 * @property {(url: string, options?: { run?: any }) => Promise<import('./pr-github.js').PrDetails>} details A fresh read of the PR for Check PR; GitHub has all of it, Azure DevOps the same shape.
 * @property {{ reasons: string[], steps: string[] }} setup The failure reasons the host's setup steps help with, and the steps.
 * @property {(url: string, cwd?: string) => PrView & { headRefOid: string }} [strictView]
 * @property {(url: string, cwd?: string) => import('./git.js').Flow} [strictViewFlow] The same as a flow of steps for the Dashboard (ADR 0030).
 * @property {(url: string, head: string, cwd?: string) => import('./git.js').Flow} [observeFlow]
 * @property {(url: string, head: string, cwd?: string) => import('./run-record.js').FollowUp} [observe]
 * @property {(repo: string, branch: string, cwd?: string) => { url: string, headRefName: string, headRepository: { name: string }, headRepositoryOwner: { login: string } }[]} [listByHead]
 */

/** @type {PrProvider[]} */
const providers = [github, azure];
const OPERATIONS = [
  'statusAsync',
  'stateAsync',
  'view',
  'viewAsync',
  'details',
  'strictView',
  'strictViewFlow',
  'observe',
  'observeFlow',
  'listByHead',
];

// The adapter that handles this PR link, or undefined when no adapter does.
/** @param {string} url */
export const providerFor = (url) => providers.find((p) => p.matches(url));
// The adapter that handles this PR link, checked to have this optional operation; throws when it does not.
/**
 * @template {Exclude<keyof PrProvider, 'name' | 'title' | 'matches' | 'repoOfRemote' | 'setup'>} K
 * @param {string} url
 * @param {K[]} operations
 * @returns {PrProvider & Required<Pick<PrProvider, K>>}
 */
export function providerWith(url, ...operations) {
  const provider = providerFor(url);
  const missing = operations.find((operation) => typeof provider?.[operation] !== 'function');
  if (!provider || missing) throw new Error(`no PR provider for ${url} has ${missing}`);
  return /** @type {PrProvider & Required<Pick<PrProvider, K>>} */ (provider);
}
// Whether the adapter that handles this PR link has this operation.
/**
 * @param {string} url
 * @param {string} operation
 */
export const can = (url, operation) => {
  const provider = providerFor(url);
  return OPERATIONS.includes(operation) && !!provider && typeof Object(provider)[operation] === 'function';
};
// The adapter that handles this git remote URL, with the repository it points at.
/** @param {string} remote */
export function remoteRepo(remote) {
  for (const provider of providers) {
    const repo = provider.repoOfRemote(remote);
    if (repo) return { provider, ...repo };
  }
  return undefined;
}
