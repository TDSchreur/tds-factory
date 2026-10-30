# Fix the flaky "Delete all asks separately" Dashboard test

## Problem Statement

`test/dashboard-page-browser.test.js` "Delete all asks separately before discarding each dirty Run" failed on `master` twice in one day (runs 41041930211 and 41045182053, Node 22 on ubuntu), while the same code passed on the pull requests that introduced those commits and on other Node versions. The failure is `2 !== 3` on `page.calls.length`.

The Dashboard closes the confirmation dialog before the last `DELETE` reaches the test server. The test waits for the dialog to close and then counts the recorded calls at once, so it races the request. The neighbouring test "active Runs offer deletion..." already has a polling wait with a comment explaining this; this test was missed. The pull request checks passed because the race depends on timing: a request that wins the race passes, and nothing in a pull request changes the odds.

## Solution

Wait for the third call to be recorded before asserting on the calls, as the neighbouring test does, with a shared helper so the wait is not copied a third time.

## User stories

1. As a maintainer, I want the Dashboard tests to give the same result on every run, so that a red `master` means a real regression.

## Implementation decisions

- Add a `waitForCalls(page, count)` helper in `test/dashboard-page-browser.test.js` that polls `page.calls.length` (up to 5 seconds, 100 ms steps) and use it in both places that wait for a request after a dialog closes.
- No production code changes.

## Testing decisions

The change is to a test. Verify it by running the test file repeatedly under CPU load and checking that it no longer fails.
