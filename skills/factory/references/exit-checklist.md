### Exit checklist

Run these steps in order after the last Ticket, before `run sync`, and again after every Rework, before you commit it. They are inline work in the Run worktree: they create no subagent, do not call `code-review` and record nothing with `run verdict`. Check still owns the review.

1. **Static checks.** Run every check CI runs that you can run here: the project's lint, typecheck and format-check commands (its `package.json` scripts or its conventions file, for example `npm run lint`, `npm run typecheck` and `npm run format:check`), plus a linter for each kind of file the diff changes, such as `shellcheck` for a shell script. The Verify command often does not run them, but CI does, so fix every failure now and run them again. List a check that cannot run here under "Not run" in `build.md`. A project with none skips this step.
2. **Term sweep.** Run `tds-factory run sweep --id <id>`, which lists every place in the README, `docs/`, the Specs, the ADRs, `GLOSSARY.md`, the Skills and the agents that still holds a term the diff changed, and add each older or other wording of a changed term with `--term` (for example "defaults to claude" for a changed default). Read every hit; make each one in a current document say the same thing in one wording, and compare the wordings when a sentence lives in more than one place. A hit marked as replaced is history and needs no change.
3. **Required artifacts.** A changelog fragment in `changelog.d/` under the right heading, `GLOSSARY.md` updated with its Avoid terms respected, the canonical spec for the changed area, and a pointer between ADRs where one supersedes or extends another.
4. **Story trace.** In `build.md`, a table with a row for each Spec story and the test that proves it. Close a story that has no test, or name it under "Left open".
5. **Security check.** In `build.md`, list each trust boundary the diff touches (external input, the working folder or environment of a subprocess, config, deleting or overwriting user data, a path that fails open) and how it is handled. Check each one against the project's "Universal safeguards" text from the conventions file when it has one.
6. **Self-check.** Read `git diff <base_sha>...HEAD` once, against the Standards, Spec and Security lenses that Check applies. Fix what you find and name what you leave under "Left open" in `build.md`. One pass only; after a Rework, read the rework diff.

On the Fast track `build.md` is three lines (what was built, the Verify result, what is left open). The story trace and the security check are written only when the diff touches a trust boundary; the static checks, the term sweep, the required artifacts and the self-check still run.

### After a Rework

A Rework is not only the listed findings. Before you commit it, run the term sweep again and read the rework diff for new surface area, because a fix often opens the next finding. Fix the cheap LOW findings in the area you are reworking instead of leaving them, since a LOW left alone tends to return as a MEDIUM. Name a LOW you leave, with the reason, under "Left open" in `build.md`. Then run the rest of the Exit checklist, verify and return to Check.
