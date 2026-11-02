# One flow of git steps runs sync for the CLI and async for the Dashboard

The Dashboard serves every request on one event loop, so a slow `git` call made with `spawnSync` blocks all other requests. The CLI wants the same Run operations (sync, clean, origin lookup) as plain blocking calls. Writing each operation twice would let the two copies drift.

Each Run operation that spawns git is written once, as a generator that yields its git calls (`gitStep` in `src/git.js`). `runSync` drives it with `git`, which blocks, for the CLI; `runAsync` drives it with `gitAsync`, which does not, for the Dashboard. The decisions between the git calls are shared, and only the way a call is run differs. The CLI keeps its function names as thin wrappers.

The trade-off is a less familiar style than `async`/`await` in those modules, in exchange for one copy of the logic. Only the paths the Dashboard calls on a request are async; `run-size.js` and `run-repair.js` are CLI-only and stay sync. Lock files and small `run.json` reads stay sync, and a lock is now held across awaits, so a concurrent action on the same Run gets the lock-held error instead of waiting.

The module split of the Dashboard (`dashboard-routes.js` route table, `dashboard-handlers.js`, `dashboard-pr-views.js`, `dashboard-view.js`) and of the PR adapters (`pr-exec.js` beside `pr-provider.js`) is organisation, not a decision, and needs no ADR of its own. [ADR 0017](0017-dashboard-write-routes-need-origin-host-and-a-session-token.md) and [ADR 0020](0020-pr-providers-sit-behind-one-seam.md) still hold.
