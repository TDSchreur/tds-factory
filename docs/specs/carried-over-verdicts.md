# Re-review smaller after a Rework

[GitHub issue #289](https://github.com/TDSchreur/tds-factory/issues/289), Full track, priority work of milestone v0.6.0. After a Rework, Check reviews all four axes again with fresh reviewers, and the review of an earlier head no longer counts, so a docs-only Rework costs a full pass of about 110k reviewer tokens.

## User Stories

1. As a user, I want a Rework that only changes documentation to keep the Security and Infrastructure verdicts, so that I do not pay for a full review of text that cannot affect them.
2. As a user, I want Standards and Spec always reviewed again after a Rework, so that stale-text findings are never hidden.
3. As the coordinator, I want `tds-factory run verdict --id ID --axis security|infrastructure --value pass|skipped --carried` to record the verdict for the current head only when it is allowed, so that I cannot carry something I should not.
4. As a user, I want the command to refuse unless the axis passed before with the same value, so that a carried verdict never invents a pass.
5. As a user, I want it to refuse after `run sync` rebased the branch (the earlier head is no longer an ancestor), so that changed code underneath is reviewed.
6. As a user, I want it to refuse when the worktree is dirty or any file changed since the earlier head is outside a fixed allowlist, so that code, tests, Skills, agents, instruction files, renames, links and executables are always reviewed.
7. As a user, I want the carried verdict to record the head it came from in the Run record and the verdict history, so that it can be audited.
8. As a user, I want Finish and the Dashboard to see a carried verdict like any verdict for the current head, so that Evidence rules are unchanged.
9. As a reviewer of an axis that is reviewed again, I want the previous findings and the rework diff in my assignment, so that I can confirm each is fixed and review what changed.
10. As a maintainer, I want the rule written in the Check section of the Skill, the glossary and an ADR, and pinned by tests, so that it cannot drift.

## Implementation Decisions

- `run verdict` gets `--carried`, valid for the axes `security` and `infrastructure`, values `pass` (both) and `skipped` (infrastructure). The value must equal the earlier verdict's value.
- The earlier verdict is the latest event of that axis in the Run's verdict history (which `run rework` does not clear), with value `pass` or `skipped`, recorded at a head different from the current one.
- The command refuses unless that head is an ancestor of the current head (`git merge-base --is-ancestor`), the worktree is clean, and every change in `git diff --raw -z --no-renames <earlier head> HEAD` is on an allowlisted path (Markdown in `docs/` outside `docs/agents/`, `changelog.d/*.md`, or `README.md`, `GLOSSARY.md`, `CONTRIBUTING.md`, `SECURITY.md`) with plain-file modes only, so both paths of a rename are checked and links, executables and submodules are refused, and anything an agent could load as instructions (hidden files and folders, folders named agents, skills, commands, prompts or instructions at any depth, instruction file names) never qualifies, as the glossary entry Carried-over verdict defines; it also refuses when the axis already failed at the current head or the earlier head is not a hex commit id. A refusal names the reason and the offending files.
- On success the axis verdict and `reviewed[axis]` are recorded for the current head and attempt as for any verdict, with `carried_from` (the earlier head) added to `reviewed[axis]` and to the verdict history event.
- The Check section of the Skill: after a Rework, give each reviewer the previous findings and the rework diff; for Security and Infrastructure try `--carried` first and review the axis only if the command refuses; Standards and Spec are always reviewed. The Left open and Blocking rules are unchanged.
- ADR 0019 records the decision; the glossary gets **Carried-over verdict**; `docs/usage.md` describes it; a changelog fragment is added.

## Testing Decisions

- Tests drive `tds-factory run verdict` in a real Run worktree: a docs-only Rework carries Security (and records `carried_from`), a code or Skill change refuses, a rebase refuses, a dirty worktree refuses, a value that differs from the earlier one refuses, Standards and Spec refuse, a carried verdict satisfies `finishProblems` for the current head, and the verdict history gains an event with `carried_from`. Skill tests pin the rule text.
- Prior art: `test/run-gates.test.js`, `test/run-store.test.js`, `test/skills.test.js`.

## Out of Scope

- Carrying Standards, Spec or project review verdicts, and carrying a Verify result (Verify always runs again).
- Measuring token use (the Run record work, #275).

## Further Notes

Analysis: Obsidian `analysis-factory-performance.md`.
