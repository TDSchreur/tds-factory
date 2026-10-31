### Added
- The Dashboard has its first actions: buttons for `run sync`, `run clean` and accepting a Check that is not clean, and a "Needs you" browser notification when a Run starts waiting on you. Starting a Run stays in the agent.

### Security
- Every Dashboard write route (`DELETE` and `POST`) now needs the page's own Origin and a per-session token, and the server sends no CORS headers. See ADR 0017.
