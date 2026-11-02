# Windows-friendly development and tests

## Problem Statement

The Factory was written on Linux. A developer on Windows cannot get a green `npm test`: the checkout has CRLF line endings, tests run `true` as the Verify command (cmd.exe has no `true`), the browser test helper needs `sh` and POSIX process groups, a few tests need symlinks and the executable bit, and `test:unit` can hang with no timeout. CI runs only the installer on Windows, so nothing keeps the project working there.

## Solution

Make the repository and its tests behave the same on Windows and Linux, and let CI prove it with a Windows job.

## User Stories

1. As a Windows developer, I want the working tree to have LF endings whatever `core.autocrlf` says, so that the Markdown parsers, Prettier and the tests agree and `npm run format` leaves no diff.
2. As a Windows developer, I want the unit tests to pass, so that I can use `npm run test:unit` as the Verify-fast command.
3. As a Windows developer, I want a test that cannot run on my platform (symlinks, the executable bit, a browser) to skip with a reason, never to fail or hang.
4. As a Windows developer with Chromium and ChromeDriver installed, I want the browser tests to run, and to leave no driver process behind.
5. As a maintainer, I want CI to run the checks and the unit tests on Windows, so that a Linux-only change is caught before merge.

## Implementation Decisions

- `.gitattributes` sets `* text=auto eol=lf`, with binary files marked, and the tree is renormalized once.
- Tests no longer use POSIX-only Verify commands: a shared helper gives a command that succeeds and one that fails on every platform (`node -e`).
- Tests that spawn the CLI or git get a timeout, so a stuck process fails the test.
- `test/browser.js` finds ChromeDriver and a browser with `where` on Windows and `command -v` elsewhere, kills the driver's process tree with `taskkill /T /F` on Windows, and keeps the POSIX process-group kill elsewhere.
- Tests that need symlinks or the executable bit skip on `win32`.
- CI gets a `windows-latest` job running `npm run check` and `npm run test:unit`.
- Documents: `docs/development.md`, `CONTRIBUTING.md` where it names the shell or line endings, and a changelog fragment.

## Testing Decisions

The change is test infrastructure, so the tests run on both platforms are the test: `npm run test:unit` and `npm run check` pass locally on Windows, and the new CI job runs them. A test pins that `.gitattributes` holds the LF rule.

## Out of Scope

The `az` launch fix (its own Run, `2026-11-02-fix-dashboard-az-not-found-on-windows-az-cmd`); PowerShell versions of `use-repo.sh` and `use-official.sh`; Windows PowerShell 5.1 ([ADR 0011](../adr/0011-install-ps1-supports-powershell-7-only.md)).

## Tickets

1. **Line endings:** `.gitattributes`, renormalize, a test that pins the rule.
2. **Portable test commands and timeouts:** the Verify commands and the spawn timeouts in the tests.
3. **Portable browser helper:** `test/browser.js` on Windows.
4. **Platform skips:** symlink and executable-bit tests skip on Windows.
5. **Windows CI job:** the `windows-latest` job in `ci.yml`, and the documents.
