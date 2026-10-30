# Delete Runs from any Dashboard column

## Problem Statement

A Dashboard card represents a Run, but Delete is available only for Done and Abandoned Runs. A Run stuck in another Stage cannot be cleaned up from the Dashboard. Uncommitted changes also block cleanup with no way to explicitly discard them and remove the Run's worktree.

## Solution

Offer individual Delete on every readable Run in every column. Keep the existing confirmation naming the Run and what will be removed. If its Factory-created worktree contains uncommitted changes, warn the user and offer a second, explicit confirmation to discard those changes and remove both the worktree and Run history. Cancellation preserves them. A nonterminal Run's confirmation tells the user to stop its agent before deleting it; deletion does not stop an agent process.

## User Stories

1. As a Dashboard user, I want Delete on a Run in Define, so that an abandoned interview can be cleaned up.
2. As a Dashboard user, I want Delete on Runs in Build, Check, and Finish, so that stuck work can be removed without changing its Stage first.
3. As a Dashboard user, I want to delete a Run marked running, waiting, interrupted, or verification unavailable, so that an outdated status does not prevent cleanup.
4. As a Dashboard user, I want Done and Abandoned deletion to keep working, so that finished history can still be cleaned up.
5. As a Dashboard user, I want the confirmation to name the Run and explain that its record, summaries, and Factory-created worktree will be removed, so that I understand the action.
6. As a Dashboard user, I want to be told to stop an unfinished Run's agent first, so that I do not remove a worktree while the agent still uses it.
7. As a Dashboard user, I want uncommitted work to trigger a warning, so that an ordinary Delete confirmation does not silently discard it.
8. As a Dashboard user, I want a separate choice to discard uncommitted changes and delete the Run and its worktree, so that I can deliberately remove stuck work.
9. As a Dashboard user, I want cancelling that choice to preserve the Run and all its work, so that I can recover or commit it instead.
10. As a Dashboard user, I want that warning to cover tracked edits, untracked files, dirty submodules, and changed submodule commits, so that all existing protections remain meaningful.
11. As a Dashboard user, I want a successful deletion to remove the card and close its Run detail, so that the page reflects the result.
12. As a Dashboard user, I want failures to retain the Run and explain what failed, so that I can resolve a git or storage problem.
13. As a Dashboard user, I want branches, linked GitHub Tickets, PRs, and Specs preserved, so that cleanup does not remove committed work or tracker artifacts.
14. As a Dashboard user, I want Delete all to remain limited to Done Runs, including hidden older Runs, so that unfinished work is never swept into bulk cleanup.
15. As a Dashboard user, I want each dirty Run encountered in bulk deletion to receive its own explicit discard confirmation, so that approving a bulk action does not implicitly discard uncommitted work.
16. As a maintainer, I want unreadable records, unsupported statuses, linked storage, held locks, and arbitrary worktree paths to remain protected, so that the new discard option does not bypass unrelated safeguards.

## Implementation Decisions

- The Run store remains the single owner of deletion and enforces eligibility at request time under its existing Run lock. Accept every supported Run status, rather than only terminal statuses. Reject unreadable records and unsupported statuses.
- Add an explicit discard-changes option to the existing remove operation. The default remains protective: detecting uncommitted work returns a distinguishable refusal without removing either history or worktree. A dirty-worktree refusal must be distinguishable from other git failures by a machine-readable signal, not by matching human-readable error text.
- The Dashboard keeps its existing DELETE route. An explicitly named discard-changes request option carries the second confirmation; ordinary DELETE requests never opt into discarding changes. Retain same-origin and loopback Host checks for both request forms. Invalid discard options fail rather than imply consent.
- A discard request only bypasses the refusal for detected uncommitted changes. Continue checking git status, storage ownership, locks, and the recorded worktree association. Failure to inspect or remove a worktree still refuses deletion and preserves the Run history. Delete history only after worktree removal succeeds.
- Only remove the Factory-created worktree at the exact expected path for that Run in the main checkout's Factory storage. Preserve adopted or external worktrees as today; never interpret the discard option as permission to remove an arbitrary recorded path. Reject symlinked owned worktree storage or a symlinked worktree path rather than following it into another directory.
- Preserve branches and external artifacts. Runs without a recorded worktree remain deletable, and an already missing Factory-created worktree does not prevent removing its history. A clean worktree containing initialized submodules or ignored build files remains removable.
- Render Delete in the existing card action area for every supported readable Run. Done collapse and Merge behavior stay unchanged. Unreadable or unsupported-status cards do not offer Delete.
- Use the existing themed dialog queue. Following the ordinary confirmation, a dirty refusal opens a destructive dialog naming that Run and explicitly stating that uncommitted changes will be permanently lost and the Run worktree removed. Only its affirmative action retries with discard enabled. Other refusals use the existing error presentation. Cancelling the discard dialog is a cancellation, not a deletion failure.
- Apply the same per-Run dirty warning to existing Done bulk deletion; do not expand bulk deletion to other columns. Refresh the page after the operation using existing polling and selection handling.
- Update the current Dashboard and usage documentation, including the canonical Dashboard behavior description, to reflect deletion from every column and the explicit uncommitted-work override. Historical Specs remain historical.

## Testing Decisions

- Prefer the existing Run store, Dashboard HTTP, and real-browser seams. Test observable deletion, retained files and branches, requests, dialogs, and resulting cards rather than helper internals.
- Run store tests cover all supported statuses; malformed or unsupported records; ordinary refusal and explicit discard for tracked/untracked/submodule changes; clean submodules; branch preservation; missing worktrees; adopted worktrees; symlink/ownership protections; held locks; and git inspection/removal failures preserving history. Extend the existing removal tests rather than introducing a new seam.
- HTTP tests cover ordinary deletion of a nonterminal Run, a distinguishable dirty refusal, explicit discard success, invalid options, and origin/Host protection for the override. Verify both the Run folder and owned worktree disappear after success.
- Real-browser tests cover Delete in each visible non-Done Stage, ordinary confirmation cancellation, dirty warning cancellation and acceptance, absence of discard retries after unrelated failures, and per-Run confirmation during Done bulk cleanup. Existing card/detail and Done bulk tests provide the prior art.
- Run the project's Verify command, `npm test`. Report browser checks as not run when their documented browser prerequisites are unavailable.

## Out of Scope

- Stopping or killing agents; detecting whether an agent is still active.
- Moving, reopening, restarting, or editing Runs.
- Deleting or closing GitHub Tickets, PRs, Specs, or branches.
- Force-removing adopted or external worktrees, repairing unreadable records, bypassing Run locks, or removing linked storage.
- Bulk cleanup of unfinished Runs, undo, or restoring discarded work.

## Further Notes

The user's term "ticket" refers to a Dashboard Run card here. The existing glossary already distinguishes these concepts, so this feature does not require new vocabulary or an ADR. The user explicitly requested an option to proceed when uncommitted changes exist, with the Run's own worktree removed.
