# Clean up Done Runs

## Problem Statement

Completed and abandoned Runs accumulate in the Dashboard's Done column. Hiding older Runs leaves unwanted records on disk.

## Solution

Let the user permanently delete individual Done Runs or all Done Runs, including those hidden by the older-Runs toggle, after a clear confirmation. Running and waiting Runs remain protected.

## User Stories

1. As a developer, I want to delete one completed or abandoned Run, so that I can remove history I no longer need.
2. As a developer, I want to delete all Done Runs, including hidden older Runs, so that I can clean up the column at once.
3. As a developer, I want confirmation to identify what will be deleted and explain that deletion is permanent, so that I can cancel a mistake.
4. As a developer, I want the Run folder and summaries removed, while linked Specs, Tickets and PRs remain intact, so that cleanup affects only Run history.
5. As a developer, I want active and unreadable Runs protected, even if a request is forged or a Run changes status, so that cleanup cannot interfere with ongoing work.
6. As a developer, I want deletion errors reported and the board refreshed, so that I can see what happened.

## Implementation Decisions

- The Dashboard offers individual and bulk deletion for records whose current status is exactly `done` or `abandoned`. Bulk deletion includes hidden older Runs. Server-side eligibility is checked at deletion time; unreadable and active records are never deleted.
- Deletion removes the Run directory and its contents only, never linked artifacts. Validate IDs and storage paths, reject symlink escapes, and refuse linked Run records.
- Preserve localhost and Host restrictions. Require same-origin protection on mutation requests, and reject cross-origin requests. Confirm actions in the UI and report failures, including partial bulk failures.
- Update the existing Dashboard spec and glossary to reflect the new control.

## Testing Decisions

Test deletion through the existing HTTP server seam with temporary project directories: eligible and active records, bulk including older records, malformed records, path traversal and symlinks, cross-origin requests, and failures. Check the page controls and confirmation behavior. Run the project's verify command.

## Out of Scope

Deleting linked issues, Specs or PRs; deleting active or unreadable Runs; restoring deleted Runs; remote Dashboard access.
