# Browser close lets Chromium exit before ChromeDriver deletes the profile

Fixes the flaky test "closing a page leaves no browser process and no scoped directory" in `test/dashboard-teardown-browser.test.js`, which failed in about 3 of 5 full `npm test` runs with "Chromium removed its scoped directories itself".

## Problem Statement

`close()` in `test/browser.js` ended a session with `DELETE /session`. ChromeDriver then deletes its temporary profile (`org.chromium.Chromium.scoped_dir.*`, the `--user-data-dir` of the browser). When Chromium still writes into the profile at that moment, which happens on a loaded machine, the delete stops half way: a `Default` directory stays in the private temp directory, nothing removes it, and the test finds it as a leftover. Waiting longer does not help: in a trial run the leftover was still there after 20 seconds. An earlier test's Chromium plays no part, because every session has its own `TMPDIR`; the full `npm test` only adds the load.

Measured before the change, 8 sessions in parallel with 24 busy loops: 8 to 11 leaked profiles in 120 to 160 sessions. A first attempt, waiting for the profile after `DELETE`, still leaked 2 in 200 sessions and timed out on the stuck profile, so it was dropped.

## Solution

`close()` first closes the browser (`Browser.close` over the DevTools protocol) and waits until the Chromium process, whose pid the session response gives (`goog:processID`), is gone. Only then it ends the session, so ChromeDriver deletes a profile nobody writes into, and stops the driver. The wait is `waitUntil` on the pid, with its default deadline; a browser that does not leave in time is killed with the driver as before, and the leftovers check reports what stayed. No retry, no longer timeout, no fixed sleep.

## User Stories

1. As a maintainer, I want the browser to be gone before ChromeDriver deletes its profile, so that the delete cannot stop half way.
2. As a maintainer, I want the teardown test to keep asserting that ChromeDriver and Chromium remove their scoped directories themselves, so that the test still guards against the pile-up in `/tmp`.
3. As a maintainer, I want a browser that never exits to be killed by the existing bounded path, so that a stuck browser cannot hang the suite.

## Implementation Decisions

- The pid comes from the session response (`capabilities['goog:processID']`). Without it (another driver) the order is unchanged.
- The change sits in `close()` in `test/browser.js`, so every browser test gets it.
- Size estimate: Ticket 1 about 1 file (`test/browser.js`, about 3 KB) plus the changelog fragment and this Spec.

## Testing Decisions

- Evidence is the stress loop (8 parallel sessions, 24 busy loops): before, 8 to 11 leaks in 120 to 160 sessions; after, 0 in 320 sessions. Then the repeat step of the reliable-tests guide on `test/dashboard-teardown-browser.test.js`: 30 runs plain, under load and with `--test-concurrency=1`, and the whole browser suite under load.
- No deterministic test: it would need a fake ChromeDriver that deletes slowly. Named under Left open.

## Out of Scope

Other flaky browser tests; the separate `diff.mnemonicprefix` failures of `test/run-sweep.test.js`.
