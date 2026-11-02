# Disable the browser tests on Windows

## Problem Statement

The browser tests drive a real browser through ChromeDriver. On Windows they are already skipped by default because they are slow there, but a developer can switch them on with `TDS_WINDOWS_BROWSER=1` or `REQUIRE_BROWSER=1`, and `test/browser.js` carries Windows-only code to find `msedgedriver`, Edge and Chrome. That code is not exercised by CI, so it is unmaintained weight, and `REQUIRE_BROWSER=1` on Windows can turn a skip into a failure.

## Solution

The browser tests never run on Windows. They always skip there, with a reason, whatever the environment says. The Windows driver and browser discovery and the opt-in are removed.

## User Stories

1. As a Windows developer, I want every browser test to skip with a clear reason, so that `npm test` never fails or hangs for lack of a driver.
2. As a Windows developer, I want `REQUIRE_BROWSER=1` to skip too, so that a variable meant for the Linux CI job cannot fail my run.
3. As a maintainer, I want no unexercised Windows driver code in `test/browser.js`, so that there is less to keep working.
4. As a reader of `docs/development.md`, I want it to say the browser tests are not supported on Windows, and nothing about an opt-in that no longer exists.

## Implementation Decisions

- `target()` in `test/browser.js` returns null on `win32`. The Edge and Chrome install-folder lookup, `msedgedriver`, the `where` lookup, the `ms:edgeOptions` and `cdp` Windows variants and `TDS_WINDOWS_BROWSER` are removed.
- `openPage` skips on Windows before it looks at `REQUIRE_BROWSER`, with the reason 'the browser tests are not supported on Windows'. The missing-browser skip message on other platforms no longer mentions `msedgedriver`.
- The Windows branch of the driver teardown (`isRunning`, the process-tree kill) stays, because `browser-teardown.test.js` tests it with fake drivers.
- The Linux and macOS behaviour, `REQUIRE_BROWSER` there, and the CI browser job do not change.
- Documents: `docs/development.md` (the "Working on Windows" paragraph and the CI paragraph) and a changelog fragment. No ADR and no glossary change.

## Testing Decisions

`WINDOWS` is read once when `test/browser.js` loads, so the skip cannot be unit-tested without a refactor that this change does not justify. The tests that remain are the proof: on Linux `npm test` and `npm run test:browser` behave as before, and `browser-teardown.test.js` still passes. The Windows branch is verified by reading the diff.

## Out of Scope

Making the browser tests fast enough for Windows, a Windows browser CI job, and the Windows branch of the driver teardown.

## Documents

`docs/development.md` (lines on browser tests in the CI and "Working on Windows" sections), `changelog.d/`, and the comment above `target()` in `test/browser.js`. `docs/specs/windows-friendly.md` is a finished Spec and stays as it is.

## Tickets

1. **Skip the browser tests on Windows:** `test/browser.js`, `docs/development.md` and a changelog fragment.
