# Cut Check loops with a broader Sweep and a sharper Exit checklist, not new gates

Runs `scope-conventions-by-path-globs` (three Checks) and two earlier Runs went back to Build for findings Build could have found: stale current documents, security-sensitive code over untrusted input with unproven "linear" claims, a hand-rolled matcher chosen in Build, and a diff too large for Check to read in one pass.

The Sweep now also derives numbers with a unit and headings that only the removed lines held, lists the lines that miss a changed list member (or still hold a removed one), and lists added lines that make a "linear", "bounded" or "safe" claim. The Exit checklist gains a hostile-input step and a hit list of the usual Check findings, and Define decides build or borrow for security-sensitive primitives and splits oversized work.

The Sweep stays read-only and judges nothing, as in [ADR 0006](0006-run-progress-goes-through-named-transitions.md)'s split between commands that gate and commands that inform. List detection covers only lines with at least three backticked names; plain-word lists remain the reader's job, which the checklist says.

The size limit (about 40 KB of diff or 15 files, and one commit per Ticket) is a warning at `run transition --to check`, not a refusal: the estimate is a judgement and a gate would block a legitimate large Run, while a warning makes it visible before reviewers get a partial diff. Check's Blocking rules and the loop cap are unchanged.

Success is measured with `tds-factory run stats`: fewer Check loops and more clean first Checks.
