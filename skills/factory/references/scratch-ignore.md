# Scratch ignore

A Local tracker keeps its Spec and Tickets under `.scratch/`, which must stay out of git. Run this when the `scratch-ignore` check of `tds-factory doctor` is `missing`, in the main checkout and before `run start`. Never stop the Run for it.

1. Resolve the paths with git: `git rev-parse --show-toplevel` for the `.gitignore`, and `git rev-parse --path-format=absolute --git-common-dir` for the shared git directory (git 2.31 or newer; with an older git resolve the relative output against the current directory). The second file is `info/exclude` inside it, which every Run worktree shares.
2. For each of the two files: when it is a symlink, do not write it and tell the user instead. Otherwise create it (and the `info` folder) when absent. Compare lines after stripping a trailing `\r` and surrounding whitespace; when a line `.scratch/` is already there, leave the file alone. If the file does not end with a newline, add one first. Append `.scratch/` followed by a newline, in the file's own line ending style (`\r\n` when it uses CRLF).
3. Write nowhere else.
4. Tell the user which files you changed or could not write, and that the `.gitignore` line is uncommitted and should be committed to the default branch so teammates and new worktrees get the same rule.

Define does not commit `.scratch/`, and Finish's PR body calls a Local tracker's Tickets "local, not committed" instead of linking their paths.
