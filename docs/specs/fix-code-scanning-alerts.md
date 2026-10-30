# Fix the two GitHub Code Scanning alerts

## Problem Statement

GitHub Code Scanning reports two open alerts: `js/regex-injection` in `scripts/next-version.js` (a RegExp built from command-line arguments) and `js/bad-code-sanitization` in `test/dashboard-responsive-browser.test.js` (a script string built by interpolating a value).

## Solution

Remove the dynamic construction. `nextVersion` matches tags with string prefix checks instead of a RegExp built from the base version. The browser test passes the Stage name as a script argument (`arguments[0]`) instead of embedding it in the script text.

## User Stories

1. As a maintainer, I want no open Code Scanning alerts, so that real findings stand out.

## Implementation Decisions

- `test/browser.js` `execute` takes an optional `args` array and forwards it.
- Behavior of `nextVersion` stays the same.

## Testing Decisions

- Existing tests cover both; `npm test` passes.
