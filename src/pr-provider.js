import * as github from './pr-github.js';

// The PR provider seam (ADR 0020): the rest of the Factory asks this module about a PR link and never calls a hosting CLI itself.
// GitHub (the `gh` command) is the only adapter today; an adapter exports `name`, `matches(url)`, `repoOfRemote(remote)` and the operations its callers use.
const providers = [github];

// The adapter that handles this PR link, or undefined when no adapter does.
export const providerFor = (url) => providers.find((p) => p.matches(url));
// The adapter that handles this git remote URL, with the repository it points at.
export function remoteRepo(remote) {
  for (const provider of providers) {
    const repo = provider.repoOfRemote(remote);
    if (repo) return { provider, ...repo };
  }
  return undefined;
}
