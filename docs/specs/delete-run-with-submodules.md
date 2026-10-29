## Problem Statement

A user cannot delete a Done Run from the Dashboard when its Run worktree contains initialised submodules. Git refuses to remove such a worktree without `--force`, even when it is clean. The delete fails, the Run stays on the Dashboard, and the message blames uncommitted changes that do not exist.

## Solution

Deleting a Done or Abandoned Run removes its Factory-created Run worktree when nothing in it would be lost, submodules included. The Run store checks the Run worktree for work that exists nowhere else, and only then removes it with force. When the delete is refused, the message says whether the cause is uncommitted work or a git failure, and shows git's own error in the second case.

## User Stories

1. As a Factory user, I want to delete a Done Run whose Run worktree has initialised submodules, so that finished Runs do not pile up on the Dashboard.
2. As a Factory user, I want to delete an Abandoned Run whose Run worktree has initialised submodules, so that stopped Runs can be cleaned up like finished ones.
3. As a Factory user, I want the delete to refuse when the Run worktree has tracked changes, so that I never lose uncommitted work.
4. As a Factory user, I want the delete to refuse when the Run worktree has untracked files, so that new files I have not committed are kept.
5. As a Factory user, I want the delete to refuse when a submodule has uncommitted changes, so that edits inside vendored code are not discarded.
6. As a Factory user, I want the delete to refuse when a submodule is checked out at a different commit than the Run worktree records, so that a deliberate submodule update is not lost.
7. As a Factory user, I want clean, initialised submodules not to block the delete, so that a normal Run worktree can be removed.
8. As a Factory user, I want ignored files such as `node_modules` not to block the delete, so that behaviour matches today for projects without submodules.
9. As a Factory user, I want an adopted worktree to be left alone, so that the Factory never touches a worktree it did not create.
10. As a Factory user, I want the refusal message to say the Run worktree has uncommitted changes when that is the cause, so that I know what to commit or discard.
11. As a Factory user, I want the refusal message to show git's error when git fails to remove the worktree, so that I can fix the real problem.
12. As a Factory user, I want the Run record to stay when the delete is refused, so that I can retry after fixing the cause.
13. As a Factory maintainer, I want the delete outcomes and HTTP statuses to stay the same, so that the Dashboard and its tests keep working.

## Implementation Decisions

- The change stays inside the Run store's remove operation. Remove, outcomes and HTTP statuses are unchanged: `deleted`, `invalid`, `not-found`, `not-allowed` and `worktree-refused`.
- Before removing a Factory-created Run worktree, the store asks git for the worktree's status with submodules included in the comparison (`git status --porcelain --ignore-submodules=none`). Any output means the worktree is dirty and the delete is refused. The output covers tracked changes, untracked files, a submodule with its own changes, and a submodule at a different commit than recorded. Ignored files are not reported and do not block.
- When the worktree is clean, the store removes it with `git worktree remove --force`. The force is safe because the status check has just shown that nothing would be lost, and it is what lets git remove a worktree that has initialised submodules. A comment on the remove operation says this.
- If the status check itself fails, or the forced removal fails, the delete is refused as `worktree-refused` and the Run record stays.
- The refusal carries a reason with it: either the worktree has uncommitted changes, or git could not remove it together with git's error text. The store returns the reason next to the outcome so the Dashboard server can put it in the response body. The outcome names do not change.
- The Dashboard server maps the reason to its existing plain-text response body. It keeps the 409 status for `worktree-refused`. The Dashboard UI is unchanged, since it already shows the response body in its "Could not delete" dialog.
- Unpushed commits inside a submodule are not checked. The Factory only consumes vendored submodules, so a dirty submodule is the case that matters.
- No change to `GLOSSARY.md`, and no ADR.

## Testing Decisions

- A good test drives the Run store through its public remove operation against a real git repository and checks the outcome and what is left on disk, not how git is called.
- The existing seam is the Run store's remove in the Run worktree tests, which use the shared git repository helper. Add cases there:
  - a clean Run worktree with an initialised submodule is deleted, and the directory and Run folder are gone;
  - a Run worktree with an uncommitted tracked change is refused and the change survives;
  - a Run worktree with an untracked file is refused and the file survives;
  - a Run worktree with a dirty submodule is refused;
  - a Run worktree with a submodule at a different commit is refused;
  - an adopted worktree is left in place.
- One Dashboard test checks that a refused delete returns 409 with a body that names uncommitted changes, and that a git failure body includes git's error. The existing deletion test is the prior art.
- Prior art: the existing remove tests in the Run worktree tests ("remove deletes the Run folder and a clean worktree but keeps the branch", "remove refuses a worktree with uncommitted changes", "remove leaves an adopted worktree alone").

## Out of Scope

- Which Runs may be deleted.
- Dashboard UI changes.
- Other Run store behaviour.
- Checking for unpushed commits inside submodules.
- Deleting a worktree the Factory did not create.

## Further Notes

The bug was seen on this repository, which has four vendored submodules. Any project that vendors submodules and starts Runs from it is affected.
