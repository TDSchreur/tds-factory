# Fresh origin-based Run worktrees

## Problem Statement

A Run can start from stale remote-tracking data, the caller's checkout, or an existing linked worktree. Its work can therefore miss the latest default-branch code or share files with another agent.

## Solution

Every Run starts in a newly created Run worktree and branch based on the freshly fetched default branch of origin. If origin cannot be fetched or its default branch cannot be determined, start fails clearly without creating a Run worktree or record.

## User Stories

1. As an agent, I want each Run to start from the latest origin default branch so my work includes current code.
2. As an agent starting from a linked worktree, I want a separate Run worktree so my changes are isolated.
3. As an agent, I want a clear failure when origin is unavailable or its default branch cannot be determined so I do not unknowingly work from stale code.
4. As a dashboard user, I want Runs started from any checkout to remain in the shared Run store.

## Implementation Decisions

- Determine the current default branch from origin itself on each start, fetch it, and use the fetched remote-tracking commit as the new branch base.
- Never adopt the caller's worktree or fall back to a local commit. Preserve safe cleanup of previously adopted worktrees.
- Fail before creating a Run record or worktree if discovery or fetch fails.
- Update the Factory instructions and user documentation to describe the new behavior.

## Testing Decisions

- Exercise Run start through the existing Run store and CLI seams using real local Git repositories, checking observable commits, isolation, and failure cleanup.
- Cover an updated remote, a changed default branch, linked-worktree callers, and inaccessible or indeterminate origin.
- Run the project's verify command.

## Out of Scope

- Updating existing Runs or modifying the caller's branch and working files.

## Further Notes

Origin must be reachable when a Run starts.
