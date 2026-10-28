# Issue Tracker

Issues for this repo live in **GitHub Issues**.

## Workflow

- **Create an issue**: `gh issue create --title "..." --body "..."`
- **View an issue**: `gh issue view <number>`
- **List issues**: `gh issue list [--label <label>]`
- **Update an issue**: `gh issue edit <number> [--title "..."] [--body "..."]`
- **Close/reopen**: `gh issue close/reopen <number>`

The `gh` CLI must be installed and authenticated. Verify with `gh auth status`.

## Labels

Tickets cut by `to-tickets` carry the `ready-for-agent` label.

## PRs as a request surface

PRs are **not** used for requesting work—only for reviewing code changes. Use GitHub Issues to request features or report bugs.
