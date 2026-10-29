# Dashboard port per repo

## Problem Statement

The Dashboard always listens on port 4317 unless I pass `--port`. When I work in several repos at once, the second `tds-factory dashboard` fails because the port is taken, and I have to pick a free port by hand each time.

## Solution

Without `--port`, the Dashboard picks a port derived from the repo it serves, so each repo gets its own port and keeps it across restarts. If that port is busy, the Dashboard moves to a free port and prints the URL. An explicit `--port` is used exactly as given.

## User Stories

1. As a developer working in several repos, I want each repo's Dashboard to start without `--port`, so that I can run them side by side without port clashes
2. As a developer, I want a repo's Dashboard to use the same port every time, so that my bookmark for that repo keeps working
3. As a developer, I want the port to depend on the repo's main checkout, so that a Dashboard started from a subfolder or a linked worktree gets the same port as one started from the root
4. As a developer, I want the Dashboard to fall back to a free port when its own port is busy, so that it starts anyway
5. As a developer, I want the printed URL to show the port actually used, so that I know where to open it
6. As a developer, I want `--port N` to be used exactly, so that a script or bookmark that depends on a fixed port keeps working
7. As a developer, I want `--port N` to fail with an error when N is busy, so that I notice instead of getting a port I did not ask for
8. As a developer, I want `--port 0` to keep giving a random free port, so that tests and one-off runs still work
9. As a developer, I want the derived port to stay in a range unlikely to collide with common tools, so that the Dashboard rarely has to fall back
10. As a developer reading the README and the usage text, I want the new default described, so that I do not expect 4317

## Implementation Decisions

- The Dashboard server chooses its port when the caller gives none. An explicit port, including 0, is used as given and an explicit busy port is an error, as today.
- The default port is derived from the absolute path of the main checkout of the repo being served, the same path the Run store already resolves, so subfolders and linked worktrees map to the same port. The derivation is deterministic: a stable hash of the path mapped into the range 4300 to 4999.
- When the derived port is busy, the server listens on a random free port instead. Only a busy port (address in use) triggers the fallback; other listen errors still fail.
- The CLI no longer defaults `--port` to 4317; it passes a port only when the flag is given. The fixed default port constant is removed.
- The URL the CLI prints is built from the port actually bound.
- No detection of a Dashboard already running for the same repo. A second one finds the derived port busy and takes a free port.
- No new glossary term and no ADR: the default is easy to reverse.

## Testing Decisions

- A good test starts the real Dashboard server and checks what a client sees: which port it bound and whether it answers. It does not look at how the port is computed.
- One seam: the Dashboard server's start function, the same seam as the existing server tests.
- Cases: two different repos started without a port get different ports; the same repo started again after closing gets the same port; a second server for a repo whose derived port is taken starts on another port and answers requests; a Dashboard started from a subfolder or linked worktree of a repo gets the same port as one from the main checkout; an explicit busy port rejects; port 0 still gives a free port.
- Prior art: the server tests in `test/dashboard.test.js` and the worktree tests in `test/run-worktrees.test.js`.
- Run `npm test`.

## Out of Scope

- Detecting or reusing a Dashboard that already runs for the same repo.
- A lock file or port registry.
- Opening the browser automatically.
- Changes to the Host check or any other server behavior.

## Further Notes

- The README sentence "The default port is 4317, and `--port` changes it" and the usage line in the CLI help are updated to describe the per-repo default.
- Two repos can hash to the same port. The fallback covers that; the URL printed at start is the source of truth.
