# Make CLI failures visible and bounded

## Problem Statement

Three things make a failure of the `tds-factory` CLI hard to see or hard to end.

1. `tds-factory update` calls `fetch` without a timeout. A server that accepts the connection and then says nothing makes the command hang for good.
2. `src/` has 41 bare `catch {}` blocks. Some ignore the error on purpose, but most do not say so, and some swallow errors that should surface: the install record read treats a corrupt record like a missing one, and the Dashboard turns any handler exception into a `500 internal error` that nobody can find in a log.
3. Failures are marked three ways: a `reason` property on PR lookup errors, a `permanent` flag on the update status error, and a regex over the message text in the project configuration. Each reader has to know which one applies, and the regex breaks when a message changes.

## Solution

- Every request `tds-factory update` makes ends within a bound. A timeout is a transient failure: it is retried like a 5xx answer and then fails with a message that names what timed out.
- Every `catch {}` in `src/` either carries a one-line comment saying why ignoring the error is intended, or is narrowed to the error codes it expects and rethrows the rest, or reports the error (a log line to stderr, or a `cause` on the replacement error). The Dashboard logs an unexpected handler exception to stderr and still answers `internal error`.
- One small error class, `FactoryError`, with a `code` and a `cause`, replaces the three markers. User-facing messages do not change.

## User Stories

1. As a user running `tds-factory update`, I want a server that never answers to fail within a bounded time, so that the command never hangs.
2. As a user, I want the timeout message to say which request timed out and after how long, so that I know what to retry.
3. As a user on a slow connection, I want a timed-out request retried like a server error, so that one slow answer does not fail the update.
4. As a user, I want the tarball download to have a longer bound than the small requests, so that a large download on a slow link is not cut off.
5. As a contributor, I want the timeout injectable in `update()`, so that a test can use a hanging server and finish in milliseconds.
6. As a Dashboard user, I want an unexpected handler exception logged to stderr with the method, path and stack, so that I can find out why I saw `internal error`.
7. As a Dashboard user, I want the response to stay `internal error`, so that no stack reaches the browser.
8. As a Dashboard user, I want the log line to leave out the query string, so that tokens in a URL never reach a log.
9. As a Dashboard user, I want a failed GitHub PR lookup, merge or checks call logged as well as answered with its 502 or 'unavailable' text, so that the cause is not lost.
10. As a user with a corrupt install record, I want `install` to say so instead of quietly starting from an empty record, so that I do not lose the record by accident.
11. As a contributor, I want every ignored error to say why in a comment, so that the next reader does not have to guess.
12. As a contributor, I want a filesystem "missing" catch to check for `ENOENT` or `ENOTDIR` and rethrow anything else, so that a permission error or a bug is not mistaken for an absent file.
13. As a contributor, I want a catch that replaces an error with a friendlier one to keep the original as `cause`, so that the real failure can be found.
14. As a contributor, I want one error class with a `code` and a `cause`, so that a reader checks one property.
15. As a contributor, I want the codes of `FactoryError` to be lowercase kebab-case, so that they can never be mistaken for a Node error code such as `ENOENT`.
16. As a contributor, I want the PR providers' failure reason carried as the `code`, so that the Dashboard reads one property.
17. As a contributor, I want the update status error to say through its `code` whether it is permanent or transient, so that `withRetry` does not depend on a class field.
18. As a contributor, I want the project configuration to find the review a message is about without a regex, so that rewording a message cannot break the line number.
19. As a user, I want every existing message to stay byte-identical, so that scripts and docs that quote them keep working.
20. As a reviewer, I want the verdict on each of the 41 catches written down, so that I can check the audit.
21. As a contributor, I want all of this to pass strict `checkJs` without casts, so that the typing work stays honest.

## Implementation Decisions

- **`FactoryError`.** A new module holds `FactoryError extends Error`, constructed as `new FactoryError(message, { code, cause })`; `cause` is the standard `Error` cause. The `code` is a lowercase kebab-case string. The class is the only error marker in `src/`. `reasonOf` and `codeOf` in the narrowing helpers keep working for it (`codeOf` reads `code`); `reasonOf` goes when its last reader does.
- **PR providers.** The GitHub and Azure providers throw `FactoryError` where they now attach `reason`. The `code` takes the values the `reason` has now (`error`, and what the providers' failure helper returns). The Dashboard reads the `code` of the error where it reads `reason` today. The status values the Dashboard answers with do not change.
- **Update.** The status error becomes a `FactoryError` with the code `http-permanent` or `http-transient`; the retry loop checks the code. A request that times out is a `FactoryError` with the code `timeout`, treated as transient. The timeout message reads `<what> timed out after <n>s`.
- **Timeouts.** Each fetch gets `AbortSignal.timeout`. The API lookup, the redirect lookup and the checksum download use a 30 s default; the tarball download uses 120 s. `update()` gains a `timeoutMs` option that sets the first bound (default 30 s); the download bound is four times that. The signal covers reading the body, so a stalled body ends too. The retry count and back-off stay as they are.
- **Project configuration.** The project review loader throws `FactoryError` with the code `review-invalid` and a `reviewId` property for the errors that name a review. The configuration reads the property and no longer parses the message. The messages are unchanged.
- **Catch audit.** Each of the 41 bare catches gets one of three treatments:
  - *Keep:* ignoring is the design (damaged or unreadable log lines, `decodeURIComponent` leading to a 400, URL and path validity checks, optional session logs, best-effort cleanup lookups). A one-line comment says why.
  - *Narrow:* a catch that means "missing" checks `codeOf(err)` for `ENOENT` or `ENOTDIR` and rethrows anything else. The install record read distinguishes a missing record (start empty) from a corrupt one (fail with a message that names the file).
  - *Report:* a catch that answers with a replacement text logs the error (the Dashboard 502 and 'unavailable' paths) or keeps the original as `cause` (catches that throw a friendlier error).
  The result is written per catch in `build.md`.
- **Dashboard 500.** The handler's last catch logs `dashboard: <METHOD> <path>` and the error's stack to stderr, with the query string left out, and answers `internal error` as before. The other Dashboard catches that report use the same log helper.
- **Typing.** All of it passes strict `checkJs` with JSDoc types and no casts or opt-outs.
- **Build or borrow.** Nothing new is borrowed: `AbortSignal.timeout` and the `Error` `cause` option are in Node 24.
- **Not touched.** The `mkdtemp` and sleep code in `update.js` and the duplicated helpers of the two PR providers belong to later Runs and stay as they are.
- **Tickets.** T1: `FactoryError` and its three sites (providers, update status, project configuration). T2: the fetch timeouts and the hanging-server test. T3: the catch audit and the Dashboard logging. T4: documentation, blocked by the others.
- **Documents.** Run `tds-factory run sweep` for `reason`, `permanent`, `catch`, `timeout` and `internal error` at the end of Build; expected: the changelog fragment, `docs/development.md` if it describes error handling, and the update documentation if it names the retries. `GLOSSARY.md` needs no change: the work adds no domain term. No ADR: the class is easy to reverse.

## Testing Decisions

- A good test checks behaviour from outside: what `update()` does against a server, what the Dashboard answers and writes to stderr, what message a caller sees. It does not check which class a private helper builds, except for the `code` that is the new contract.
- **Seams.** `update()` with an injected `fetchFn` and `timeoutMs` (prior art: `test/update.test.js`); the Dashboard server started in a test with a capture of stderr (prior art: the Dashboard tests); the PR provider status functions with an injected runner (prior art: the provider tests); `loadProjectConfig` over a temporary project (prior art: `test/project-config.test.js`); `install` over a temporary home.
- A hanging `fetchFn` that only settles when its signal aborts must make `update()` reject within a small multiple of `timeoutMs`; a timeout on the first attempt followed by an answer must succeed; a permanent status must not be retried.
- A handler that throws must produce a 500 `internal error`, one stderr line with the method and path, no query string, and no stack in the body.
- A corrupt install record must fail with a message; a missing one must not.
- Existing tests for the messages stay as they are and prove they did not change.

## Out of Scope

- Replacing the sleep or the temporary folder code in `update.js` with newer Node APIs.
- Merging the two PR providers' duplicated helpers, and splitting `startDashboard`.
- Timeouts on spawned `git` or `gh` processes.
- A logging framework or a log level; stderr lines only.
- Changing any user-facing message.

## Further Notes

Part 2 of the v0.6.3 plan, after the two typechecking Runs. The brief named `src/dashboard.js:500` for the unlogged 500; on the current `develop` it is the last catch of the request handler.
