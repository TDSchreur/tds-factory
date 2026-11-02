# Remove duplication in the CLI and split the Dashboard server

## Problem Statement

1. The two PR provider adapters (`src/pr-github.js`, `src/pr-azure.js`) each carry the same plumbing: a `promisify(execFile)` runner with hard-coded `env` and `maxBuffer`, a `spawnSync` wrapper for the synchronous view, and a helper that builds a reason-carrying `FactoryError`. ADR 0020 puts every host behind one seam, but each adapter holds more than what differs between hosts.
2. A small `git()` helper (`spawnSync('git', args, { cwd, encoding: 'utf8', ... })`) is written inline in `src/origin.js`, `src/evidence.js`, `src/run-lifecycle.js` (twice), `src/run-clean.js` (twice), `src/worktrees.js`, `src/doctor.js`, `src/run-size.js` and `src/run-sweep.js`, and `spawnSync('git', ...)` is called directly in more places.
3. `startDashboard` in `src/dashboard.js` is about 340 lines with an inline router.
4. The Dashboard server is async, but the paths it calls on each request reach `spawnSync` and `readdirSync` through `src/run-folder.js`, `src/run-size.js` (256 MiB `maxBuffer`), `src/run-repair.js` and `src/run-lifecycle.js`. One slow git call blocks every other request.

## Solution

- **Provider plumbing.** One module next to `src/pr-provider.js` holds the shared runner, sync wrapper and reason-error helper. Each adapter keeps only what differs (patterns, parsing, commands, error codes).
- **`src/git.js`.** One `git` helper with the options callers need (`cwd`, `timeout`, `env`, `maxBuffer`), used everywhere git is spawned in `src/`.
- **Dashboard.** `startDashboard` keeps the server, the Host and token guard and the lifecycle; a route table and the handlers move into their own module(s). Routes, methods, status codes, response bodies and the write guard of ADR 0017 do not change.
- **Async per-request paths.** Every path the Dashboard calls per request that runs git or reads a folder with a sync call gets an async variant, and the Dashboard uses it. The CLI keeps the sync functions.

## User Stories

1. As a contributor, I want the runner, the sync wrapper and the reason-error helper in one place, so that a change to them is one edit.
2. As a contributor, I want each PR adapter to hold only what differs by host, so that a third host is small.
3. As a contributor, I want one `git` helper, so that a timeout, environment or buffer rule is set once.
4. As a contributor, I want `startDashboard` to read as setup, with a route table and named handlers, so that I can find and test a route.
5. As a Dashboard user, I want a slow git call not to block other requests.
6. As a user, I want every Dashboard route, status code, response and the write guard (Origin, Host, token) unchanged.
7. As a user, I want CLI output, `run.json` and error messages byte-identical.
8. As a contributor, I want `src/pr-github.js` and `src/pr-azure.js` still the only files that run `gh` and `az` (a test pins this).

## Implementation Decisions

- **Behaviour is frozen.** The existing tests are the contract; a test changes only where it names a moved function or file.
- **Provider plumbing.** New module `src/pr-exec.js` (name may differ) beside `src/pr-provider.js`. The injected `run` test seam of the adapters stays. `repoOfRemote` and `parseStatus` differ by host (different patterns and shapes), so only the shared parts of them (for example the trimming and the owner/name check) move; the host-specific parts stay.
- **`src/git.js`.** `git(cwd, args, options)` or `git(cwd, ...args)` returning the `spawnSync` result; the signature is chosen so each existing call site stays a one-liner. It also exports an async variant for the Dashboard path. Sites with special options (`origin.js` timeout and `GIT_TERMINAL_PROMPT` env, `run-size.js` 256 MiB buffer, `run-sweep.js` 64 MiB buffer) pass them as options; the defaults and values do not change. Git calls that are not a plain git helper use (for example `sync.js` `execFileSync` with `-C`) may stay when they cannot use the helper without a change.
- **Dashboard split.** New modules (for example `src/dashboard-routes.js` and a handlers module); `startDashboard` imports the route table. Injected options and the returned `{ server, port, url, close }` stay. Whether the split is a design decision worth an ADR is decided in the documentation Ticket: add an ADR only if the split fixes a rule future routes must follow (for example "a route is a table entry and a handler; a handler never calls a sync spawn").
- **Async paths.** An audit lists every per-request call. Each gets an async variant (using the async git helper and `fs.promises`), sharing parsing with the sync one so logic is not copied. The sync functions stay for CLI callers. A slow-call test proves another request is answered while a git call runs.
- **Windows.** No path or separator behaviour changes.

## Testing Decisions

The existing suite is the main guard. New tests only for new behaviour: `src/git.js` (options, async variant), and a Dashboard test that a second request is answered while a slow async git call is pending.

## Out of Scope

New routes, changed responses, a third PR provider, async CLI commands.

## Documents

`docs/development.md`, `docs/dashboard.md`, `docs/adr/0020-pr-providers-sit-behind-one-seam.md`, `GLOSSARY.md` if a term changes, `changelog.d/remove-cli-duplication.md`, and an ADR only as decided above.
