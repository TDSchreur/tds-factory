# Dashboard: Azure DevOps pull request status

## Problem Statement

The Dashboard shows the status of a Run's pull request (checks, merge conflicts, review state, draft) only for GitHub, because the one PR provider adapter runs `gh` ([ADR 0020](../adr/0020-pr-providers-sit-behind-one-seam.md)). A Run whose repository lives in Azure DevOps shows no PR status, no state in the Done Stage and no way to tell from the Dashboard that its PR has conflicts. This is the eighth and optional item of the Dashboard work in milestone v0.6.0.

## Solution

A second adapter, `src/pr-azure.js`, handles Azure DevOps PR links and reads a PR with the `az` command (`azure-devops` extension), read-only. The existing PR status block shows its result in the same shape as for GitHub. The Done Stage gets the PR state (open, merged, closed) and Clean up works from it. Merge, which writes, stays GitHub-only: an Azure DevOps PR shows a note to merge it in Azure DevOps, and Follow-up on such a PR says it is not supported yet. A missing `az`, a missing extension or a missing sign-in shows "status unavailable" with the command that fixes it, and never breaks the Dashboard.

## User Stories

1. As a user with a Run in Azure DevOps, I want its card to show the PR status (checks, conflicts, review state, draft) in the same block as for GitHub, so that I do not open Azure DevOps to learn whether the PR is ready.
2. As a user, I want the Done Stage to show the PR as open, merged or closed, and Clean up to work after the PR is merged, so that finished Azure DevOps Runs behave like GitHub ones.
3. As a user, I want a failing or pending required policy (build validation included) to show as failing or pending checks, with the policy names, so that I see what blocks the PR.
4. As a user, I want a PR with merge conflicts to say so, so that I know to Sync.
5. As a user, I want the review state from the reviewers' votes (approved, changes requested, review required), so that I know who is the next to act.
6. As a user without `az`, without the `azure-devops` extension or without a sign-in, I want "status unavailable" with the exact fix (`az extension add --name azure-devops`, `az login`), so that I can repair my setup without reading code.
7. As a user, I want no Merge button on an Azure DevOps PR and a clear note to merge it in Azure DevOps, so that the Dashboard never offers an action it cannot do.
8. As a user, I want Follow-up on an Azure DevOps PR to refuse with a clear message instead of failing in a confusing way.
9. As a maintainer, I want every `az` call in one adapter, read-only, with a test that no write subcommand (`create`, `update`, `complete`, `delete`, `set`) occurs there, and with the Factory never touching the `develop` branch of the Aanvragen App repository, so that a test or a bug cannot write to a live repository.
10. As a maintainer, I want the adapter tested against recorded `az` output from the Kahoot sandbox repository (and no test calling `az`), so that parsing matches reality.

## Implementation Decisions

- **Link and remote.** `matches(url)` accepts `https://dev.azure.com/<org>/<project>/_git/<repo>/pullrequest/<id>` only (organisation `[\w.-]+`, project and repository percent-encoded names, a positive integer id). The legacy `visualstudio.com` form is not supported. `repoOfRemote(remote)` reads `https://[user@]dev.azure.com/<org>/<project>/_git/<repo>` and `git@ssh.dev.azure.com:v3/<org>/<project>/<repo>` and returns `{ owner: '<org>/<project>', name: '<repo>' }`.
- **Calls.** Read-only `az repos pr show --id <id> --organization https://dev.azure.com/<org> --output json --only-show-errors` and `az repos pr policy list --id <id> --organization ... --output json --only-show-errors`, run in parallel through `execFile` with an argument array (no shell), a 20 s timeout and `AZURE_CORE_NO_COLOR=1`. Only validated pieces of the link reach the arguments. The adapter is the only file that runs `az` (a test pins this) and holds no write subcommand (a test pins this too).
- **Mapping.** `parseStatus(pr, policies)` returns the same shape as the GitHub adapter. State: `active` is open, `completed` merged, `abandoned` closed. `isDraft` is the draft flag. `mergeStatus` `succeeded` is mergeable and `conflicts` is conflicting; anything else is unknown. Checks: among the policies that are blocking and not `notApplicable`, `rejected` or `broken` is failing (named by the policy type's display name, and the build name when the settings have one), `running` or `queued` is pending, `approved` is passing; no policies is none. Review: a reviewer vote of -10 (rejected) or -5 (waiting for the author) is changes requested; otherwise at least one vote of 10 or 5 and no required reviewer or "Minimum number of reviewers" policy still open is approved; an open reviewer policy without a negative vote is required; otherwise none. The exact fields are fixed against the recorded fixtures; an unexpected shape throws and shows as unavailable.
- **State and details for other callers.** The adapter has `stateAsync(url)` (open, merged or closed in the casing the callers already accept) and `view(url)` (state and head commit, `lastMergeSourceCommit`) for Run clean-up. It has no `merge`, `viewAsync`, `checksSummary`, `strictView`, `observe` or `listByHead`.
- **Capabilities.** The seam gets `can(url, operation)`: true when the adapter that handles the link has that operation. The Dashboard views carry `prCanMerge`; the Merge route answers 409 "<host> cannot merge from the Dashboard" (for example "Azure DevOps cannot merge from the Dashboard") for an adapter without `merge`, and the Merge and merge-checks routes keep their other guards. Run repair skips an adapter without `listByHead`. Follow-up throws "Follow-up needs a GitHub PR URL" with Azure DevOps named for an Azure DevOps link ("Follow-up does not support Azure DevOps yet").
- **Failures.** A failure carries a `reason`: `az-missing` (no `az` binary), `az-extension-missing` (no `azure-devops` extension), `az-not-signed-in` (no or expired sign-in, 401/403 text), `rate-limited` and `error`. The Dashboard keeps its per-PR cache and its refresh limit. The texts in `dashboard/model.js` name the fix.
- **UI.** The PR status block, the "Check again" button and the Done Stage badge are unchanged. An Azure DevOps PR in Done with state open shows the text "Merge it in Azure DevOps" where the Merge button would be. Nothing else in the page names GitHub for an Azure DevOps PR (the merge-checks line is GitHub-only).
- **Safety.** Tests never run `az` or reach the network. The fixtures are recorded from the sandbox repository `https://dev.azure.com/<organisation>/Projects/_git/Kahoot` and scrubbed of organisation ids, user ids, e-mail addresses and tenant ids. No code or test runs `az repos pr create/update/complete` and no code names the Aanvragen App repository; its `develop` branch is never touched.
- **Documents.** `docs/dashboard.md`, an addendum to ADR 0020 (the second adapter and the capability rule), the glossary entry **PR provider** and a changelog fragment.

## Testing Decisions

- Unit tests for `matches` and `repoOfRemote` (valid and hostile links: other hosts, a query string, an id of 0 or 1e3, encoded slashes, control characters), for `parseStatus` over the recorded fixtures (passing, conflicts, pending policy, failing policy, completed, abandoned, draft, votes) and over malformed shapes, for the failure classification with injected `run`, and for the capability helper.
- Static tests: only `pr-azure.js` runs `az`; no write subcommand occurs in it; no source or test file mentions the Aanvragen App repository outside the safety statement in the docs.
- Dashboard route tests with an injected Azure adapter: status route, Done state, Merge 409 for a host without `merge`, the views' `prCanMerge`.
- Browser tests with the stub server: an Azure DevOps PR shows the status block, the unavailable texts with their fixes, and the note instead of a Merge button.
- The Kahoot capture is a manual step of Build with the user's consent; its commands and the clean-up (PRs abandoned, branches and policy removed) are recorded in `build.md`.

## Out of Scope

Merging, commenting, voting or any other write on Azure DevOps; Follow-up on Azure DevOps; Azure Boards work items; the legacy `visualstudio.com` link; Doctor checks for `gh` and `az` (candidates for 0.7.0); several organisations signed in at once.
