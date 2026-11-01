### Added
- The Dashboard shows the status of a Run's open GitHub pull request on its card and in its detail, for every Stage that has a PR: checks (with the failing names), merge conflicts, review state and draft. The status is cached, never delays a poll, and shows "PR status unavailable" with a Check again button when `gh` cannot answer. `GET /api/runs/<id>/pr-status[?refresh=1]` returns it.
