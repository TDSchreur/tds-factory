# Size gate leftovers: shared link class, lost events, git timeout, Spec wording

Finishes [Size gate: estimate in Define, split proposal, check during Build](run-size-gate.md) (design: [ADR 0035](../adr/0035-build-waits-on-the-user-when-a-run-outgrows-the-size-limit.md)). Issue [#532](https://github.com/TDSchreur/tds-factory/issues/532), split off from [#530](https://github.com/TDSchreur/tds-factory/issues/530), which carries the Dashboard buttons ([Split and Continue](dashboard-split-and-continue.md)).

## Problem Statement

The first size-gate Runs left four loose ends. The Spec says things the code does not do (and the other way round). Two places that print links from the tracker, `run split` and the Dashboard split answer, clean control characters with different character classes, so a link can look different on the two surfaces. When the `split` or `size-accepted` event cannot be written, the command silently loses it: the code around the write expects a throw that never comes. And a hung or huge git measurement of the Run size either blocks the command or, on a timeout, reads as "unknown", which lets a Run pass the size gate.

## Solution

One shared helper cleans the printed links for both surfaces. A lost `split` or `size-accepted` event is reported on stderr while the command still succeeds. The git measurement gets a time limit, and a timeout counts as over the limit like an overflow of its output; `run size` says why the size is unknown. The Spec, ADR 0035, the Glossary and the user documents say what the code does.

## User Stories

1. As a user, I want a link printed by `run split` and by the Dashboard split answer to be cleaned the same way, so that I see the same text on both and a tracker title cannot hide or reorder text in my terminal.
2. As a user, I want control characters, format characters and the line and paragraph separators in a link replaced by a space, so that a link stays on one line and readable.
3. As a maintainer, I want one helper with one direct test, so that the next place that prints a link uses the same class.
4. As a user, I want `run split` to print the links and exit 0 when the `split` event cannot be written, so that the moved Tickets are never lost to a logging problem.
5. As a user, I want a `note:` line on stderr in that case, so that I know the Event log lacks the entry.
6. As a user, I want the same for `run size --accept` and the `size-accepted` event, so that my answer is recorded in the Run record and the missing log entry is reported.
7. As a user, I want a git measurement that takes longer than a minute to count as over the size limit, so that a hung or huge repository cannot pass the size gate and I can still answer Continue.
8. As a user, I want `run size` to say that the size is unknown because git timed out or its output was too large, and counted as over the limit, so that I do not read sentinel numbers as a real size.
9. As a user, I want a Run whose measurement timed out to wait for my answer in Build like an over-limit Run, so that the gate behaves the same for every unknown that counts as over.
10. As a maintainer, I want the timeout to be an option on the measurement, so that tests do not wait a minute.
11. As a reader of the Spec, I want stories 5 and 7 of the size gate Spec to say that `size --accept` also works on a running Run in Build or Check, so that the Spec matches the code.
12. As a reader of the Spec, I want the Measure bullet, ADR 0035 and the Glossary entry **Run size** to say that an overflow of the output and a timeout count as over the limit.
13. As a reader of the Spec, I want one consistent account that Run B was cut into several Runs (Size gate B, `run-size-gate-b.md`, and #530).
14. As a user, I want `docs/usage.md` and the Skill's progress commands to say that `--accept` also works on a running Run, so that I can silence the transition warning.

## Implementation Decisions

- **Shared link class.** A new small module exports the one class: control characters, format characters and U+2028 and U+2029 (with the `u` flag), each replaced by a space. Only `run split` and the Dashboard split answer use it. All other filters (rules, guides, Sweep, PR text, the 409 and log lines) stay as they are. U+200D inside an emoji becomes a space too; that is accepted.
- **Lost event.** `appendEvent` returns a boolean and never throws. `splitRun` and `sizeRun` check it instead of the dead try/catch: when it is false, the command still prints the links or succeeds with exit 0 and writes a `note:` line on stderr. Other callers of `appendEvent` stay unchanged.
- **Git timeout.** A fixed time limit of 60 seconds per git call (two calls, so up to 120 seconds), a constant with an option for tests like the output limit; no environment variable. A timeout (`ETIMEDOUT`, as the origin check already treats it) counts as over the limit, like an overflow of the output.
- **Reason.** `runSize` returns the reason when it counted as over for a timeout or an overflow. `run size` then prints "size unknown: git timed out (or its output was too large), counted as over the limit" instead of sentinel numbers. The wait after `tickets_done` rises uses the same result, so a timeout makes the Run wait.
- **Seam for git.** `runSize` accepts an injectable `git` function, so a test returns `ETIMEDOUT` without a slow process.
- **Documents.** From the Sweep: `docs/specs/run-size-gate.md` (stories 5 and 7, the Measure bullet, the account of Run B), ADR 0035 and `GLOSSARY.md` (**Run size**: overflow and timeout count as over the limit), `docs/usage.md` and `skills/factory/references/progress-commands.md` (`--accept` on a running Run), one changelog fragment for the Run. The Glossary Avoid terms hold; no new term is introduced.

## Size estimate

Count as the Run size counts (no lockfiles, no `test/fixtures/`), tests at their real size, Markdown by line length. Files shared between Tickets count once in the total.

| Part                                                                                                                                 | Files  | KB     |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------ |
| Define artifacts (this Spec)                                                                                                         | 1      | 5      |
| Ticket 1: shared link class (new module, its test, `run split` in the CLI, the Dashboard split handler)                              | 4      | 2      |
| Ticket 2: lost event (`run-lifecycle.js`, `run-size-gate.test.js`)                                                                   | 2      | 2      |
| Ticket 3: git timeout and reason (`run-size.js`, `run-size.test.js`; `run-lifecycle.js`, the CLI and `run-size-gate.test.js` shared) | 2      | 3      |
| Ticket 4: documentation (size gate Spec, ADR 0035, Glossary, usage, progress commands, changelog fragment)                           | 6      | 3      |
| **Total**                                                                                                                            | **15** | **15** |

The total is 15 files, at the file limit and above two thirds of it (10 files); 15 KB is well inside 27 KB. Files, not bytes, are the pressure.

## Testing Decisions

- A good test goes through the command or the module interface and checks what the user sees, not the internals.
- `test/printable.test.js` (new, direct): BEL, U+202E, U+200B, U+2028, a ZWJ emoji, a newline and a very long input. The existing split tests of the CLI and the Dashboard check one cleaned link each.
- `test/run-size-gate.test.js` (extended, temporary repository like its existing tests): events.jsonl as a symlink makes `appendEvent` return false; `split` and `size --accept` still succeed, print the links and write a `note:` on stderr; a timeout makes the Run wait through the size gate.
- `test/run-size.test.js` (extended): an injected `git` returning `ETIMEDOUT` gives an over-limit result with the reason `timeout`; an overflow gives `overflow`; `run size` prints the unknown-size sentence.

## Out of Scope

The Dashboard buttons ([#530](https://github.com/TDSchreur/tds-factory/issues/530)); an environment variable for the time limit; changing other `appendEvent` callers (`run-folder.js`, `evidence.js`) or other character filters; measuring uncommitted work.
