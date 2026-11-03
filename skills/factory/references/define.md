# Define details

## Build or borrow

When a Ticket needs a security-sensitive primitive the platform does not offer (a glob or path matcher, a parser of untrusted text, an archive extractor, a sanitizer), Define names the approach in the Spec or the Ticket before Build starts: a dependency, a simpler syntax that the platform handles, or a hand-rolled one with a required adversarial test (see the Exit checklist's hostile-input step). Check the project's supported runtime versions before you decide that the platform lacks it. Build does not make this choice alone.

## Size

The Spec holds a size estimate: a table with a row per Ticket, a row for the Define artifacts and a total, the Spec counted, in files and KB of diff. Count what the Run size counts (no lockfiles, no `test/fixtures/`), with tests at their real size, Markdown by the length of its lines. Estimates run low, so the Run fits only when the total stays at or under two thirds of the limit: 10 files and 27 KB. The limit itself (about 40 KB, about 15 files) stays what Build enforces: Build waits for the user when the Run outgrows it, and `run transition --to check` warns, without refusing, when the diff is larger or the branch has fewer commits than Tickets. Build commits once per Ticket.

Above two thirds of the limit, Define proposes a split with a suggested cut in the confirmation, and the user decides; never split without the answer. After the user confirms a split, Tickets exist only for the first Run. Each later Run gets one issue with its scope (what it carries, why it was cut, what it needs first) and no Ticket label; the first Run's Spec names those issues, and the later Run starts with `/factory` and its own Define.

## Tracker labels

Before you ask about a label the tracker needs, look it up: use the label from `labels.ticket` in `tds-factory run config` (default `ready-for-agent`); on GitHub run `gh label list --search <name> --json name` and match the exact name in the output, because a search also returns labels that only resemble it. Ask the user to create the label only when no result matches the exact name, and never run `gh label create` before the lookup. If `gh label create` fails because the label already exists, treat the label as present and carry on. On another tracker, if a label it needs does not exist, ask the user before creating it.

## Documents

The Spec's Documents bullet lists the files that describe the feature, not the kinds of document. Before you write it, run `tds-factory run sweep --id <id> --term <word>` in the Run worktree for each key term of the feature (a setting, a command, an option, the old wording it replaces) and keep the current documents, canonical specs and help text it lists. A canonical spec of the changed area and the command line help are the usual misses.

A Full track Run with three or more Tickets gets one last documentation Ticket, blocked by every other Ticket. Its input is the Sweep output at the end of Build: it brings every document, canonical spec, guide, glossary entry and help text the Sweep still lists in line with the finished feature, and it writes the Sweep paragraph in `build.md`. The Fast track and a Run with fewer than three Tickets get no extra Ticket; their Tickets update the documents they touch.

A Local tracker keeps its Spec and Tickets under `.scratch/`, which Preflight keeps out of git (see Gitignore in `SKILL.md`). Do not commit or force-add `.scratch/`; `tickets` in the Run record keeps the repo-relative paths.
