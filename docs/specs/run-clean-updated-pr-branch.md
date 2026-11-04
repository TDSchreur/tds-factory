# Run clean after "Update branch" on GitHub

## Problem

`run clean` keeps a merged Run unless its local branch tip equals the PR head exactly (`src/run-clean.js`). GitHub's "Update branch" adds a merge commit to the PR, so the PR head moves ahead of the local tip and `run clean` refuses with "the branch has commits that are not in the merged PR", although nothing local is unmerged.

## Spec

`run clean` cleans a merged Run when the local branch tip is the PR head or an ancestor of it, checked with `git merge-base --is-ancestor <local tip> <PR head>`. A tip that is not an ancestor still keeps the Run with the existing reason. When the PR head commit is not present locally, the Run is kept with a reason that tells the user to fetch it; `run clean` does not fetch. The branch is still deleted only if its tip equals the tip read before the PR lookup, so a commit made during the lookup keeps the branch. The Dashboard clean and Doctor's merged-leftover report use the same rule.

## Ticket

One Ticket: change `src/run-clean.js`; tests in `test/run-clean.test.js` for a PR head ahead of the local tip (cleaned), a diverged head (kept) and a missing head object (kept with the fetch hint); a `changelog.d` fragment; the `run clean` text in `skills/factory/references/progress-commands.md` and the docs, if they say "equals".
