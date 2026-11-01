import * as github from './pr-github.js';
import * as azure from './pr-azure.js';

// The PR provider seam (ADR 0020): the rest of the Factory asks this module about a PR link and never calls a hosting CLI itself.
// An adapter exports `name`, `title`, `matches(url)`, `repoOfRemote(remote)` and the operations its callers use. GitHub (the `gh` command) has all of them;
// Azure DevOps (the `az` command) only reads: PR status, state and head. A caller asks `can(url, operation)` before it uses an operation not every adapter has.
const providers = [github, azure];
const OPERATIONS = ['statusAsync', 'stateAsync', 'view', 'viewAsync', 'merge', 'checksSummary', 'strictView', 'observe', 'listByHead'];

// The adapter that handles this PR link, or undefined when no adapter does.
export const providerFor = (url) => providers.find((p) => p.matches(url));
// Whether the adapter that handles this PR link has this operation.
export const can = (url, operation) => OPERATIONS.includes(operation) && typeof providerFor(url)?.[operation] === 'function';
// The adapter that handles this git remote URL, with the repository it points at.
export function remoteRepo(remote) {
  for (const provider of providers) {
    const repo = provider.repoOfRemote(remote);
    if (repo) return { provider, ...repo };
  }
  return undefined;
}
