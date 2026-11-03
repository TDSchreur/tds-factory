# Scratch ignore

A Local tracker keeps its Spec and Tickets under `.scratch/`, which must stay out of git. Run this when the `scratch-ignore` check of `tds-factory doctor` is `missing`, in the main checkout and before `run start`. Never stop the Run for it.

1. Append the line `.scratch/` to `.gitignore` at the top of the working tree (`git rev-parse --show-toplevel`). Create the file when it is absent, keep a trailing newline and do not add the line when a line `.scratch/` is already there.
2. Append the same line to `info/exclude` inside the common git directory (`git rev-parse --git-common-dir`), which every Run worktree shares. Create the folder and file when they are absent, with the same rules.
3. Write nowhere else, and do not write through a symlink that leaves the repository.
4. Tell the user which files you changed, and that the `.gitignore` line is uncommitted and should be committed to the default branch so teammates and new worktrees get the same rule.

Define does not commit `.scratch/`, and Finish's PR body calls a Local tracker's Tickets "local, not committed" instead of linking their paths.
