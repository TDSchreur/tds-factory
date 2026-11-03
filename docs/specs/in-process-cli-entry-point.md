# In-process CLI entry point

## Problem Statement

Working on the Factory is slow. `npm run test:unit` takes 25 to 50 seconds, and about 45 of the 131 test files start `node bin/tds-factory.js` for every CLI call. One start costs about 85 ms of wall time and 100 ms of CPU (Node's own start is 31 ms; the rest loads the code), and a typical Run test makes 6 to 20 calls. The CPU adds up when 15 test files run side by side, and the slowest files bound the whole run. After the work on lazy imports and the compile cache, a spawn is still a spawn.

## Solution

The CLI gets an in-process entry point, `main(argv, context)`. It runs a command with the given working directory, environment and output sinks and returns the exit code. `bin/tds-factory.js` becomes a thin wrapper around it. The tests call `main` directly through one async test helper instead of spawning, so a CLI call costs the work of the command and no process start. A few tests keep spawning the real binary, because the process boundary is what they test.

## User Stories

1. As a maintainer, I want `npm run test:unit` to take much less time, so that I wait less after every Ticket.
2. As a maintainer, I want one entry point `main(argv, context)` that returns an exit code, so that the CLI can run without a process of its own.
3. As a user of `tds-factory`, I want every command to print, fail and exit exactly as before, so that nothing in my scripts or in the Skills changes.
4. As a user, I want the start-up time from the lazy imports and the compile cache kept, so that `tds-factory --version` stays fast.
5. As a contributor, I want `bin/tds-factory.js` to stay a thin wrapper that only passes the real `process` values to `main`, so that there is one place where commands are dispatched.
6. As a contributor, I want a command's output to go through the context's `stdout` and `stderr` sinks, so that a test reads exactly what the command printed and nothing else leaks into the test runner's output.
7. As a contributor, I want the modules that print (`install`, `sync`, `rules`, `update` and the Run lifecycle's note) to take a sink or a `log` parameter, so that no code path of a command writes to `console` behind the context's back.
8. As a contributor, I want a call with a working directory and an environment to run as if the process had been started there, so that tests can use fake `gh` commands, a temporary Factory config folder and a Run worktree.
9. As a contributor, I want the working directory and the environment restored after every call, also when the command throws, so that one test cannot change the next.
10. As a contributor, I want calls to `main` that set a working directory or environment to wait for each other, so that two tests running side by side in one file never see each other's state.
11. As a contributor, I want `process.exitCode` left alone by `main`, so that a test that checks an exit code reads the returned value and the test runner's own exit code is not changed.
12. As a contributor, I want the failure message of a command sanitized as it is today, so that control characters in an error still show as `?`.
13. As a contributor, I want one async test helper that returns `{ status, stdout, stderr }`, so that a migrated test changes only its helper and adds `await` at the call sites.
14. As a contributor, I want every test file whose helper spawns the CLI to use that helper, except the tests of the process boundary, so that the speed-up reaches the whole suite.
15. As a contributor, I want a few tests to keep spawning `bin/tds-factory.js` (the exit code and the streams of a real process, `--version`, the Dashboard launch and the install scripts), so that the wiring of the binary itself stays tested.
16. As a contributor, I want a test that runs the same arguments in process and as a spawned binary and compares status, stdout and stderr, so that the two cannot drift apart.
17. As a Windows contributor, I want the helper to work on Windows, where the working directory and the environment are case-insensitive and `PATH` may be spelled `Path`, so that the suite behaves the same there.
18. As a maintainer, I want a short ADR that records why the tests run the CLI in process and what stays spawned, so that the next person knows the boundary.

## Implementation Decisions

- **Entry point.** A new module holds `main(argv, context)`, with the dispatch that now lives in the bin file. `argv` is the arguments after the script name. `context` has `cwd`, `env`, `stdout` and `stderr`; each is optional and defaults to the real process (`process.cwd()`, `process.env`, and writers for `process.stdout` and `process.stderr`). `main` resolves to the exit code (0, or 1 for an error, the usage with a command, a failed Verify, a failed `doctor`) and never sets `process.exitCode` or calls `process.exit`.
- **Thin wrapper.** `bin/tds-factory.js` imports `main`, passes `process.argv.slice(2)`, sets `process.exitCode` to the result and keeps the shebang. The `dashboard` command keeps its signal handlers in the wrapper's path of the real process: `main` receives the means to register a stop through the context, so a test can start and close a Dashboard without sending a signal.
- **Lazy imports and compile cache stay.** The compile cache is enabled by the wrapper before `main` is imported, because the cache only helps modules that load after it. `main` keeps importing each command's modules inside the command. Imports are cached by Node, so the first call in a test process pays for them and the rest do not.
- **Output through sinks.** Everything a command prints goes to `context.stdout` or `context.stderr`: the bin's own `console.log` and `console.error` calls, and the printing of `install`, `sync` and the Run lifecycle's note (`rules` and `update` already take `log` and `warn`). The default writers use the real streams, so a spawned binary prints as before. No code patches `console` or `process.stdout`.
- **Working directory and environment.** The commands read `process.cwd()` and `process.env` in many places (git, the project registry, `gh`, the Verify command, the Usage readers). The context's `cwd` and `env` are therefore applied to the real process for the duration of the call: `process.chdir` and a replacement of the `process.env` entries, both restored in a `finally`. Calls that set `cwd` or `env` run one after the other through a queue, so overlapping calls from tests in one process do not mix. A call that sets neither runs without the queue. On Windows the environment is matched case-insensitively when it is restored.
- **Errors.** A thrown error is printed as `error: <message>` to `stderr` with control characters shown as `?`, and the exit code is 1, as today. A `FactoryError` code is not shown. Unexpected rejections are not swallowed.
- **Test helper.** `test/cli-runner.js` exports `cli(cwd, ...args, options?)`, which calls `main` with `cwd`, the test process's environment plus the options' `env`, and collecting sinks, and returns `{ status, stdout, stderr }` (strings). The tests keep their own thin helpers (`run`, `ok`) on top of it, so most call sites only gain an `await`. A test that checks how a real process ends keeps `spawnSync` of `bin/tds-factory.js`.
- **What stays spawned.** The tests of the exit code and the streams of the real binary, `--version`, `dashboard` launch and its port handling, `install.sh` and `install.ps1`, `update` against a stub `npm`, and the browser tests. A parity test runs several commands both ways and compares the results.
- **Run in slices.** The work is cut so that each slice is a working state: the entry point and the process-state handling first, then the tests that cost the most, then the rest of the suite and the documents.

### Size estimate

| Part                                                              | Files  | KB of diff |
| ----------------------------------------------------------------- | ------ | ---------- |
| Entry point, wrapper, sinks (install, sync, Run lifecycle)        | 5      | 24         |
| Process state handling and its tests                              | 3      | 8          |
| Test helper and the parity test                                   | 2      | 6          |
| Migration of the nine slowest test files and their helpers        | 12     | 20         |
| Migration of the other 20 test files                              | 20     | 24         |
| Documents (ADR, development guide, changelog fragment, this Spec) | 4      | 12         |
| **Total**                                                         | **46** | **94**     |

The total is far above two thirds of the size limit (10 files and 27 KB), so Define proposes three Runs: the entry point with the process state handling and the helper (about 10 files, 38 KB, with the first test files migrated to prove it), then the migration of the slow test files, then the rest of the suite with the documents.

## Testing Decisions

- A good test here runs the CLI as a user does and checks the exit code, `stdout` and `stderr`, never the internals of `main`.
- The single seam is `main`: `test/cli-main.test.js` covers the usage, an unknown command, an error and its sanitizing, a successful `run start` and `run inspect`, the restoring of the working directory and the environment after a call and after a throw, and two overlapping calls with different environments.
- The parity test spawns `bin/tds-factory.js` for the same arguments and compares status, `stdout` and `stderr` with the in-process result.
- Prior art: `test/cli-version.test.js` and `test/run-cli.test.js` spawn the binary today; `test/git-repo.js` isolates the Factory config folder, which the helper must keep doing; the rules in the `reliable-tests` guide apply (own temporary folders, no fixed sleeps).
- After each migration the timing of `npm run test:unit` is recorded in `build.md`, and the full `npm test` must stay green.

## Out of Scope

- Rewriting the CLI in another language, or changing what any command does.
- Making the commands themselves faster, or running tests in worker threads.
- The Dashboard server and the browser tests, which already run in process or need a real browser.
- Changes to how `npm test` shards or splits files.

## Further Notes

- The user chose an async helper, sinks for the output and migration of every CLI helper over a sync helper, patching `console` and migrating only the slow files.
- Documents: `docs/development.md` (the section on running tests), `docs/adr/0030-one-flow-of-git-steps-runs-sync-for-the-cli-and-async-for-the-dashboard.md` (read for the sync/async boundary of git steps; it stays), `docs/specs/remove-cli-duplication.md` (read, not changed), the new ADR and a changelog fragment.
