# Explicit Run recovery

## Problem Statement

A stalled Run is difficult to diagnose: its lock has no owner, inspection cannot discover a worktree whose record was lost, and a failed record write during start leaves a branch and worktree behind. Agents also use human waiting for interruptions and unavailable verification, making Dashboard cards misleading. Repeating work without reconciling git and GitHub can duplicate changes or PRs.

## Solution

Keep inspection read-only and add explicit recovery through `run repair --id ID`. The command prints a proposed repair before any change and acts only with `--apply`. Repair reconciles existing git work and GitHub PRs, preserves dirty worktrees and reconstructs a conservative record for an orphaned Run worktree. Locks record their owner and are never expired by age. Separate pause statuses tell the user whether an answer is needed, verification cannot run or the agent was interrupted.

## User Stories

1. As a user, I want inspection to show a lock's PID, host and start time, so that I can investigate its owner.
2. As a user, I want an old live lock preserved, so that long-running work is not interrupted.
3. As a user, I want unknown or foreign-host lock ownership reported honestly, so that uncertainty cannot authorize deletion.
4. As a user, I want repair to print its proposed changes without applying them, so that I can review recovery first.
5. As a user, I want `--apply` to be required for every repair mutation, so that diagnosis remains safe.
6. As a user, I want repair to clear a lock only when its same-host owner is demonstrably dead, so that another agent's work remains protected.
7. As an agent, I want repair to reconcile the branch and current head before repeating work, so that existing commits are preserved.
8. As an agent, I want repair to discover an existing GitHub PR for the Run branch, so that recovery does not create a duplicate PR.
9. As a user, I want unavailable or ambiguous GitHub results shown as unresolved, so that recovery never guesses at a PR.
10. As a user, I want dirty worktrees preserved, so that unfinished work survives recovery.
11. As a user, I want an orphaned Run worktree visible to inspection, so that missing records do not hide my work.
12. As a user, I want repair to recreate a missing record for that orphan, so that it returns to the Dashboard without invented progress.
13. As a user, I want damaged existing records preserved, so that recovery does not overwrite history it cannot understand.
14. As a user, I want start to remove its new worktree and branch when record persistence fails, so that failed starts do not leave misleading Runs.
15. As a user, I want cleanup failures reported with the surviving resources, so that remaining work is diagnosable.
16. As a user, I want waiting to mean that the agent needs my answer, so that Dashboard requests for attention are accurate.
17. As a user, I want unavailable verification named separately from a failed Verify command, so that an unrun check is never shown as a test failure or pass.
18. As a user, I want agent interruption named separately, so that I know work needs explicit resumption.
19. As an agent, I want to explicitly resume a paused Run, so that repair does not silently restart work.
20. As a user, I want existing Finish and Evidence gates preserved during recovery, so that adopted git or GitHub state cannot authorize unreviewed work.

## Implementation Decisions

- The Run store remains the sole owner of records, lock diagnostics and repair. The CLI exposes `run repair --id ID [--apply]`; a plan is printed first in both modes. No mutation occurs without `--apply`, including clearing locks or creating Run folders. Application rechecks the facts that authorize its changes rather than trusting a stale proposal.
- New per-Run locks contain JSON owner metadata: PID, hostname and start timestamp. Start time is diagnostic, never a lease or timeout. Normal release removes only the lock this operation owns. Inspection reports owner details and whether a local process is alive, dead or unknown; legacy, malformed and foreign-host owners remain unknown. A same-host PID that still exists is treated conservatively as live even when PID reuse is possible.
- Repair can clear a pre-existing lock only when its recorded same-host PID is demonstrably gone. Live, foreign-host, malformed and legacy ownership blocks application. Permission errors and uncertain process checks are not evidence of death. Never add an age-based expiry or force-unlock escape hatch.
- Inspection and repair consider the union of Run folders and git-registered worktrees at the store's own per-Run paths. Only a valid Run id with the matching local branch and an actual registered worktree can authorize orphan reconstruction. External worktrees, symlinked storage, arbitrary record paths and ambiguous branch ownership are not adopted.
- Reconciliation reads git registration, branch, head, dirty state and existing Evidence. For GitHub origins it queries PRs for the exact repository and Run branch, including closed and merged PRs. An unambiguous matching PR can restore a missing PR link; conflicting existing links, multiple matches, unresolved origin and unavailable GitHub access are reported rather than guessed. GitHub read failure blocks any proposed GitHub-dependent mutation, and the plan names what remains unresolved.
- Repair never runs implementation, verification, pushes, issue creation, PR creation or merge. It does not advance Stage, Ticket counts or status to done; it does not invent, refresh or bless Evidence or an Accepted Check. Existing stale Evidence remains visibly stale. Finding a merged PR alone cannot bypass Flow gates.
- Dirty worktrees are reported and preserved, including during orphan recovery. Repair never resets, cleans, checks out over, removes or force-removes worktrees or branches. Missing or unregistered worktrees are diagnosed with manual next steps when safe recovery cannot be determined.
- Orphan recovery writes a minimal record only when the record is genuinely missing. It uses the known id/path and an interrupted status with a clear reason; Stage starts conservatively at Define, Ticket counters at zero, the Verify command empty and Conventions empty. Unknown original agent, base commit, links and Evidence are omitted. Existing malformed records are preserved and reported for manual recovery. Recovery requires reconciliation before continuing the Flow, so the conservative Stage is not an instruction to repeat already completed work.
- If persisting a newly started Run fails after worktree creation, start removes its newly created worktree without forcing dirty removal and deletes only its newly created branch after the worktree is safely removed. Preserve the original persistence error; include any rollback failure and surviving resource paths. Never delete a pre-existing branch or worktree, and preserve any unexpected dirty worktree.
- Add `verification-unavailable` and `interrupted` Run statuses, with a required nonempty `status_reason`; `waiting` keeps its human-only meaning and existing `waiting_reason`. These two new statuses always have `waiting_on_human: false`. Explicitly updating to `running` clears pause reasons; terminal Runs retain their existing immutability. Existing records remain readable.
- Agents can record either new pause state through ordinary update. Verification execution failures that mean it could not run must not count as passing Evidence; distinguish launch/environment unavailability (including shell command-not-found or not-executable outcomes, conventionally 127 and 126) from an executed command returning an ordinary failing exit code, and distinguish signal interruption from an ordinary failure. Preserve diagnostic output and reason. A missing Verify command during Preflight still follows the existing human-question workflow.
- Dashboard cards and Run detail show `Needs you`, `Verification unavailable` or `Agent interrupted` with the corresponding reason. Only human waiting uses the `Needs you` treatment. Paused Runs remain in their current Stage. No background timeout infers that a quiet agent was interrupted.
- Update CLI help, usage documentation and the Factory Skill's schema and recovery instructions. Reinstall the changed Factory Skill as required by the Flow.

## Testing Decisions

- Test external behavior at the existing CLI seam with real temporary git repositories and worktrees; use direct Run store calls where fault injection is required. Reuse fake GitHub executables from the Dashboard PR tests rather than requiring network access.
- Prove a dry-run repair changes no records, locks, branches or worktree files. Prove applying a safe plan is repeatable and revalidates ownership and git/GitHub facts.
- Cover live old locks, dead local locks, unknown/foreign owners, malformed metadata and legacy empty locks. No case may use age to authorize removal.
- Cover dirty orphan reconstruction, healthy no-op repair, stale Evidence, missing and unregistered worktrees, malformed records, exact-repository PR discovery, ambiguity and GitHub unavailability. Assert repair never invokes work creation or destroys dirty files.
- Inject record-write failure after worktree creation and assert worktree/branch rollback. Cover cleanup failure without losing the original error or unsafe removal.
- Cover new status validation, explicit resumption and clearing reasons, terminal immutability and old records. Exercise unavailable versus failed verification and interruption, and prove none creates passing Evidence.
- Extend Dashboard API/component tests to assert all three labels and reasons and that only human waiting is treated as needing an answer.
- Run the repository Verify command, `npm test`, and report any environmental validation that could not run.

## Out of Scope

- Automatic resumption, background recovery, lock leases, age-based unlock, force unlock and remote process termination.
- Guessing the original Spec, Tickets, Stage, agent, Verify command, base commit or Evidence for a lost record.
- Replacing damaged history, automatically repeating work, recreating missing worktrees from uncertain data or bypassing Check and Finish gates.
- New dependencies, another Run persistence layer or a general workflow engine.

## Further Notes

The user confirmed conservative explicit recovery and the distinct pause statuses. This Spec supersedes the recovery, lock ownership and failed-start-cleanup exclusions in the Run flow enforcement Spec; its named transitions and Evidence policy remain authoritative.
