# Browser tests wait for a poll, not for two seconds

## Problem Statement

`npm run test:browser` takes about 48 seconds on a 16 core machine, and its 26 files add up to about 190 seconds when run one after another. The Dashboard polls every 2000 ms, and the tests cannot change that. Fourteen tests wait a fixed 2200 to 2500 ms for a poll to happen, and one of them repeats the wait in a loop. These waits are the slowest tests of the suite (2.5 to 7.5 seconds each, about 60 of the 190 serial seconds). They are also the kind of wait the reliable-tests guide forbids: a fixed sleep stands in for "the poll happened", so a slow runner can still fail and a fast one wastes the time.

## Solution

A browser test can ask for a short poll interval, and it waits for the poll itself. The test helper serves the Dashboard's constants file with the interval of the test, so the product code, its 2000 ms default and every test that does not ask stay as they are. A new wait resolves once the stub server has answered a given number of polls, with a deadline and a message. The fixed poll sleeps in the four slowest files move to it.

## User Stories

1. As a maintainer, I want `npm run test:browser` to be much faster, so that I run it before every Check instead of leaving it to CI.
2. As a maintainer, I want a test that needs a poll to wait for the poll, so that the test cannot pass or fail because a fixed sleep was too short or too long.
3. As a test author, I want to give `openPage()` a poll interval, so that a test that needs several polls does not take several 2 second waits.
4. As a test author, I want a wait for a number of polls, so that I say what I wait for instead of how long.
5. As a test author, I want "nothing happened" checks, such as a poll not taking focus away, to wait until the poll has really happened, so that the check proves something.
6. As a test author, I want a test that does not ask for a poll interval to keep the 2000 ms of the product, so that the tests I did not touch behave as before.
7. As a maintainer, I want the browser tests to fail loudly when the interval constant is renamed or moved, so that a short interval is never silently replaced by the long one.
8. As a maintainer, I want the shipped Dashboard to have no setting, parameter or global that changes its poll interval, so that no test hook ends up in the product.
9. As a maintainer, I want the rewrite of the constants file tested without a browser, so that it runs in `npm run test:unit` and fails in seconds.
10. As a reviewer, I want the PR to give the measured time of `npm run test:browser` before and after, so that I see the gain and no test asserts a time.
11. As a test author, I want the guide for browser tests in `docs/development.md` to mention the interval option and the poll wait, so that I use them for new tests.
12. As a maintainer, I want the short sleeps that are not poll waits left alone and named as left open, so that this change stays small.

## Implementation Decisions

- The test helper's stub server serves the Dashboard's constants file with the value of the poll interval replaced. The replacement is a small pure function that takes the file text and a number of milliseconds and returns the new text. It throws an error that names the file and the expected line when the constant is not found exactly once.
- `openPage()` gets an optional `pollMs` option. Without it the file is served unchanged and the page polls every 2000 ms. A test opts in; there is no short default.
- The stub server counts the polls it has answered (the requests for the Run views) and keeps the count on the page object it returns. A wait for polls resolves when a given number of further polls has been answered. It is built on the existing bounded wait, so it has a deadline and a message, and no fixed sleep.
- The product code does not change: no URL parameter, no global, no new export for tests. The 2000 ms constant keeps its value and its place.
- The poll waits of 2200 to 2500 ms in the four slowest files move to the new option and wait: the polling tests of the page, scroll, actions and project rows files. The short sleeps (50 to 300 ms: the info request, small settles) stay and are named as left open in the PR.
- No ADR and no glossary change: the change is test-only and easy to revert, and no domain term is new.
- The size of the Run (files and KB of diff, Spec included): the Spec 1 file and about 5 KB. Ticket 1 (helper, option, wait, unit test, scroll file) 3 files and about 4 KB. Ticket 2 (page file) 1 file and about 1.5 KB. Ticket 3 (actions and project rows files) 2 files and about 2 KB. Ticket 4 (documentation: the development guide and the changelog fragment) 2 files and about 1 KB. Total 9 files and about 13.5 KB, under two thirds of the limit (10 files and 27 KB).

## Testing Decisions

- A good test checks external behavior: what the page does and what the helper returns, not how the helper builds it.
- The seam for the rewrite is the pure function: it replaces the constant, it keeps the rest of the text byte for byte, and it throws for a missing or a duplicated constant. It runs in `npm run test:unit`, in a file that does not import the browser, and so is not named as a browser test.
- The seam for the wait is the real page: the migrated browser tests prove that a short interval and the poll wait work end to end. Each migrated test keeps its assertions.
- Each Ticket runs the repeat step of the reliable-tests guide on the changed test files: 30 runs plain, 30 under load and 30 with `--test-concurrency=1`.
- Prior art: `test/wait-until.test.js` for the bounded wait, the stub server and `page.waitFor` in the browser helper for waits on the page, and the teardown tests for the helper's own behavior.
- The measured time of `npm run test:browser` is reported in the PR. No test asserts a duration.

## Out of Scope

- Sharing one ChromeDriver or Chromium per test file (about 0.4 seconds per `openPage()`): it weakens the isolation and cleanup that the teardown Specs fixed, and needs its own stress loop.
- Moving assertions that do not need a browser into unit tests.
- Any change to the Dashboard code, its 2000 ms poll interval or its documentation of the refresh.
- The short sleeps of 50 to 300 ms in the browser tests.

## Further Notes

- Measured before the change: about 48 seconds for `npm run test:browser`; the files that wait for polls take 28.6 s (page), 17.7 s (project rows), 12.8 s (scroll), 11.6 s (actions) and 11.1 s (responsive) when run alone.
- Documents: `docs/development.md` (the paragraph on the browser tests), a fragment in `changelog.d/`, and the browser helper's own comments. `docs/usage.md` and the Dashboard guide state that the Dashboard refreshes every two seconds; that stays true. `docs/specs/typecheck-tests-strict-checkjs.md` mentions `page.waitFor` and is historical.
