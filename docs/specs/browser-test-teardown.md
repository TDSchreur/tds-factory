## Problem Statement

Every Dashboard browser test starts a ChromeDriver and a Chromium session. The harness (`test/browser.js`) ended a test by sending `DELETE /session` and killing ChromeDriver at once. Each test left an `/tmp/org.chromium.Chromium.scoped_dir.*` directory of about 2 MB; `/tmp` held thousands of them. Observed before the fix: one browser test file of 4 tests added 4 directories.

## Solution

Make the harness teardown end ChromeDriver and every Chromium process it started, wait for them to exit so Chromium removes its temporary profile, and bound every wait so a stuck browser cannot hang the suite.

## User Stories

1. As a developer, I want running the browser tests not to grow `/tmp`, so that repeated runs do not fill the disk.
2. As a developer, I want teardown to work after a passing test, a failing assertion and a failed browser start, so that no path leaks.
3. As a developer, I want a stuck browser to be killed after a short wait, so that the suite never hangs.

## Implementation Decisions

- Teardown order: delete the WebDriver session (with a timeout), ask ChromeDriver to shut down, wait a bounded time for exit, then kill the whole ChromeDriver process group and wait a bounded time.
- ChromeDriver starts in its own process group so the fallback kill also reaches Chromium children.
- Teardown is idempotent and exported as a helper so it can be tested without a browser.
- No age-based cleanup of `/tmp`; only processes the harness started are touched.

## Testing Decisions

- A browserless test uses a fake driver that ignores shutdown and SIGTERM and checks teardown returns within its bounds and the process is gone.
- A browser test checks that after `close()` no process of the session remains and no scoped directory is added, for a normal close and for a failed session start.
- Run `npm test`, and compare the `/tmp` count before and after repeated runs.

## Out of Scope

- Removing directories already in `/tmp`.
- Changing which browser tests exist.

## Further Notes

One vertical Ticket. No ADR needed.
