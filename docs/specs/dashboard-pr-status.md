# Dashboard: pull request status

## Problem Statement

The Dashboard shows a pull request's state only on Done cards, and only as open, merged or closed. A user cannot see whether the checks pass, whether the PR conflicts with the base or whether it is approved without opening GitHub. This is the third item of the Dashboard work in milestone v0.6.0.

## Solution

Show the status of a Run's open GitHub pull request on its card and in its detail, for every Stage that has a PR (Finish, Follow-up and Done): checks, merge conflicts, review state, draft and the PR link. The status is read through the PR provider seam ([ADR 0020](../adr/0020-pr-providers-sit-behind-one-seam.md)) with the GitHub adapter only. It is read-only and never blocks the board.

## User Stories

1. As a user, I want the card of a Run with an open PR to show whether its checks pass, fail (with the failing check names) or are pending, so that I know whether the PR can merge.
2. As a user, I want it to show whether the PR conflicts with its base branch, so that I know to sync.
3. As a user, I want it to show the review state (approved, changes requested, review required, none) and whether the PR is a draft.
4. As a user, I want the PR link on the card in every Stage that has a PR, not only Done.
5. As a user, I want a merged or closed PR to show no extra status lines, because the state badge says it.
6. As a user, I want the status to be cached per PR, so that the Dashboard does not call the provider on every poll.
7. As a user, I want a poll never to wait for the provider: the card says "checking" until the first answer arrives.
8. As a user, I want "PR status unavailable" with the reason (`gh` missing, not signed in, rate limited, other) and a Retry button when the provider fails, so that I can fix the cause and ask again, and the rest of the board keeps working.
9. As a user, I want the Merge action to behave as before.
10. As a maintainer, I want tests to inject the provider's runner and use recorded `gh` output as fixtures, so that tests need no network.

## Implementation Decisions

- The GitHub adapter gets `statusAsync(url, { run })`. One call, `gh pr view <url> --json state,mergeable,reviewDecision,statusCheckRollup,isDraft`, parsed by the exported pure `parseStatus(json)` into `{ state: open|merged|closed, draft, checks: { result: passing|failing|pending|none, failing: [names] }, merge: mergeable|conflicting|unknown, review: approved|changes-requested|required|none }`. At most 5 failing names, each cut to 80 characters. A response that does not have the expected shape throws "incomplete GitHub PR status". `run` defaults to the promisified `execFile` and is the injection point for tests.
- A failure carries a `reason`: `gh-missing` (ENOENT), `not-signed-in` (stderr mentions authentication or login), `rate-limited` (stderr mentions a rate limit) or `error`.
- The Dashboard takes a `prStatus(url)` option, default `providerFor(url).statusAsync`. A cache per PR URL keeps a success for 60 seconds, a merged or closed PR for 10 minutes and a failure for 30 seconds. At most one lookup per URL is in flight. `/api/views` answers at once from the cache; a missing or expired entry starts a background lookup, and until the first answer the view says `{ checking: true }`. A stale entry is served while it refreshes.
- `/api/views` carries `prStatus` on a Run with a GitHub PR link in Finish, Follow-up or Done that is not abandoned or unreadable: `{ checking: true }`, `{ unavailable: <reason> }` or the parsed status. It is `null` otherwise.
- `GET /api/runs/<id>/pr-status[?refresh=1]` answers the same object for that Run. With `refresh=1` it skips the cache and waits for the lookup (bounded by the adapter's 10 second timeout). It is a GET that writes nothing, so it needs no session token. It answers 404 for an unknown Run and 409 for a Run without a GitHub PR link. The Merge route and its checks are unchanged.
- Page: a PR status block on the card and in the detail: link, then Checks, Merge, Review and Draft as text. Unavailable shows the reason and a Retry button.
- `docs/dashboard.md`, `GLOSSARY.md` (PR status) and a changelog fragment are updated. ADR 0020 gets a short addendum that the adapter now has a status operation.

## Testing Decisions

- Adapter tests (`test/pr-github-status.test.js`) feed `parseStatus` fixtures in `test/fixtures/pr-status/`: `passing.json` is real `gh` output recorded from merged PR #344; the others (failing, pending, conflicting, changes-requested, draft, malformed) are edited copies of it, and the test file says so. They also test the failure reasons through the injected runner.
- Server tests drive `startDashboard` with an injected `prStatus`: the cache between polls, the non-blocking first answer, failure and recovery, no lookup for a merged PR beyond the cache window, no lookup for a non-GitHub link, and the new route.
- Browser tests with the stub server: the block for each state, the Retry button calling the route, and that a Run without a PR shows nothing.

## Out of Scope

Azure DevOps, merging changes, any write route, notifications about status changes.
