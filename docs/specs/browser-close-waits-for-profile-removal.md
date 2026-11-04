# Browser close waits for ChromeDriver to remove the profile

Fixes the flaky test "closing a page leaves no browser process and no scoped directory" in `test/dashboard-teardown-browser.test.js`, which failed in about 3 of 5 full `npm test` runs with "Chromium removed its scoped directories itself".

## Problem Statement

`openPage` in `test/browser.js` closes a session with `DELETE /session`, then `stopDriver` sends `/shutdown` and waits until the driver's process group is gone. ChromeDriver deletes its temporary profile (`org.chromium.Chromium.scoped_dir.*`, the `userDataDir` of the session) after it has answered the DELETE. Under load that delete is still running when `/shutdown` arrives, the driver exits in the middle of it, and `close()` finds the half-deleted profile in the private temp directory. An earlier test's Chromium plays no part: every session has its own `TMPDIR`. The failure is rare alone and common when many browser sessions run at once, as in the full `npm test`.

Measured before the fix, 8 sessions in parallel with 24 busy loops: about 7 leaked profiles in 100 sessions; the profile had 34 entries after `DELETE` and 1 after `stopDriver`.

## Solution

`openPage` reads `capabilities.chrome.userDataDir` from the session response. `close()` waits, after `DELETE /session` and before `stopDriver`, until that directory no longer exists (`waitUntil`, its default deadline, a message that names the directory). No retry, no longer timeout, no sleep.

## User Stories

1. As a maintainer, I want `close()` to wait for the profile ChromeDriver is deleting, so that `/shutdown` cannot cut the delete short.
2. As a maintainer, I want the teardown test to keep asserting that ChromeDriver and Chromium remove their scoped directories themselves, so that the test still guards against the pile-up in `/tmp`.
3. As a maintainer, I want a close that hangs on a profile that never goes away to fail with the directory in the message, so that the cause is visible.

## Implementation Decisions

- The path comes from the session response (`capabilities.chrome.userDataDir`), not from a guess in the temp directory. A session that fails to start has no path and skips the wait.
- The wait sits in `close()` in `test/browser.js`, so every browser test gets it.
- Size estimate: Ticket 1 about 1 file (`test/browser.js`) plus the changelog fragment and this Spec; about 3 KB in total.

## Testing Decisions

- Evidence is the stress loop (8 parallel sessions, 24 busy loops, at least 150 sessions) failing before and passing after, then the repeat step of the reliable-tests guide on `test/dashboard-teardown-browser.test.js`: 30 runs plain, under load and with `--test-concurrency=1`.
- No deterministic test: it would need a fake ChromeDriver that deletes slowly. Named under Left open.

## Out of Scope

Other flaky browser tests; the separate `diff.mnemonicprefix` failures of `test/run-sweep.test.js`.

## Further Notes

Documents: `.github/instructions/reliable-tests.instructions.md` is unchanged; the helper's comment above `stopDriver` gets the cause.
