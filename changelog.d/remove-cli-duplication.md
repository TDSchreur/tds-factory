### Changed

- The Dashboard no longer blocks other requests while a git call runs: the git calls of a request are async.
- One git helper (`src/git.js`) and one shared module for the PR adapters (`src/pr-exec.js`) replace the copies in each module, and `startDashboard` is split into a route table and handlers. Routes, auth and responses are unchanged.
