# Define details

## Build or borrow

When a Ticket needs a security-sensitive primitive the platform does not offer (a glob or path matcher, a parser of untrusted text, an archive extractor, a sanitizer), Define names the approach in the Spec or the Ticket before Build starts: a dependency, a simpler syntax that the platform handles, or a hand-rolled one with a required adversarial test (see the Exit checklist's hostile-input step). Check the project's supported runtime versions before you decide that the platform lacks it. Build does not make this choice alone.

## Size

Estimate the diff when you cut the Tickets. When it passes about 40 KB or about 15 files, split the work into separate Runs or into Tickets that each fit well below that, because Check reviewers read about 40 KB inline and a larger diff reaches them in pieces. Build commits once per Ticket. `run transition --to check` warns, without refusing, when the diff is larger than that or the branch has fewer commits than Tickets.

## Tracker labels

Before you ask about a label the tracker needs, look it up: use the label from `labels.ticket` in `tds-factory run config` (default `ready-for-agent`); on GitHub run `gh label list --search <name> --json name` and match the exact name in the output, because a search also returns labels that only resemble it. Ask the user to create the label only when no result matches the exact name, and never run `gh label create` before the lookup. If `gh label create` fails because the label already exists, treat the label as present and carry on. On another tracker, if a label it needs does not exist, ask the user before creating it.

## Documents

The Spec's Documents bullet lists the files that describe the feature, not the kinds of document. Before you write it, run `tds-factory run sweep --id <id> --term <word>` in the Run worktree for each key term of the feature (a setting, a command, an option, the old wording it replaces) and keep the current documents, canonical specs and help text it lists. A canonical spec of the changed area and the command line help are the usual misses.

A Full track Run with three or more Tickets gets one last documentation Ticket, blocked by every other Ticket. Its input is the Sweep output at the end of Build: it brings every document, canonical spec, guide, glossary entry and help text the Sweep still lists in line with the finished feature, and it writes the Sweep paragraph in `build.md`. The Fast track and a Run with fewer than three Tickets get no extra Ticket; their Tickets update the documents they touch.
