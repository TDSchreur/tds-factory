## Problem Statement

A Run leaves its worktree under `.factory/worktrees/` and its local branch behind after the PR is merged. `run complete` runs when the PR is opened, so nothing in the Factory ever removes them, and a maintainer ends up with a dozen old worktrees and branches. The installed `tds-factory sync` is also listed in USAGE to every user, though it only works in a checkout.

## Solution

`tds-factory run clean --id ID` and `run clean --all` remove the worktree and local branch of every Run whose PR is merged, and never touch anything else. `run complete` tells the user to run it after the merge. `tds-factory doctor` adds a non-blocking note naming `run clean --all` when merged Runs still have a worktree or branch. USAGE marks `sync` as a checkout-only maintainer command.

## User Stories

1. As a maintainer, I want `run clean --id ID` to remove the worktree and branch of a Run whose PR is merged, so that old Runs do not pile up.
2. As a maintainer, I want `run clean --all` to do this for every merged Run, so that I can sweep in one command.
3. As a maintainer, I want a Run with no PR, an open PR, or a closed unmerged PR left alone, so that unfinished work is never lost.
4. As a maintainer, I want a worktree with uncommitted changes kept, with a message saying so, so that no work is discarded.
5. As a maintainer, I want a branch with commits that are not in the merged PR kept, so that later work on the branch is not lost.
6. As a maintainer, I want `run clean` to refuse from inside the worktree it would remove, with a message to run it from the main checkout.
7. As a maintainer, I want the Run record and its Stage summaries kept, so that the Dashboard still shows the finished Run.
8. As a user of `run complete`, I want to be told which command removes the worktree after the merge.
9. As a user of `doctor`, I want a note, not a failure, when merged Runs still hold a worktree or branch, so that Preflight keeps passing.
10. As a user of the installed Factory, I want USAGE to say `sync` needs a checkout.

## Implementation Decisions

- A Run counts as merged when its recorded `pr` link is in state `MERGED` according to `gh pr view`. The lookup is injectable so tests need no network; when `gh` fails, the Run is skipped with the reason.
- The branch is deleted by compare-and-delete of its tip (`git update-ref -d`; a squash merge leaves it unmerged to git) only when its head equals the merged PR's head commit and no other worktree has it checked out. Any other head is kept and reported.
- Only a Run whose status is `done` is cleaned, so that `inspect` does not report a missing worktree for a Run still going. The branch head is checked again under the lock.
- The worktree is removed after the same status check `remove` uses (untracked files visible, submodules inspected). Git needs `--force` for a worktree with an initialised submodule, as in this repository, and that deletes the submodules' repositories, so the worktree is kept when a submodule has commits no remote has or a stash. The Run record must name the store's own worktree path. Only the store's own worktree path is touched, never a symlinked or adopted one.
- `clean` takes the Run lock, keeps `run.json` and the summaries, and is idempotent: a Run already cleaned reports `already clean`.
- Each Run yields one line: `cleaned <id>`, `kept <id>: <reason>` or `already clean <id>`. `--all` goes through every Run folder with a `pr` (a Run without one is not listed).
- `run complete` prints the hint; it does not clean, because the PR is not merged yet at that point. The Dashboard merge button is out of scope.
- Doctor gets a `notes` array in its report beside `checks`; `ok` ignores it. `doctor` prints each note after the checks. It looks only at Runs that are `done`, still have a worktree or branch and record a `pr`, the Runs `run clean` can take; it calls `gh` once per such Run.
- `skills/factory/SKILL.md` lists `run clean` among the progress commands and tells Finish to run it from the main checkout after the merge. The README or usage docs describe the command.

## Testing Decisions

- Seam: the Run store (`openRunStore(...).clean`) over a real temporary git repository with injected PR state, plus the CLI for the output lines and the hint; Doctor over a temporary project like the existing Doctor tests.
- Cases: merged and clean is removed with its branch; open, closed, missing PR kept; dirty worktree kept; branch head differing from the PR head kept; run from inside the worktree refused; record kept and `inspect` reports no problems after; `--all` mixes; second clean is `already clean`; Doctor note appears with `ok` unchanged.

## Out of Scope

- Cleaning from the Dashboard, deleting remote branches (GitHub deletes them on merge), cleaning Runs without a recorded PR.

## Further Notes

Asked for after a clean-up of 8 worktrees and 27 remote branches by hand.
