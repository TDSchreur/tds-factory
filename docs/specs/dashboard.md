# Dashboard

## Problem Statement

When I run the Factory, the Flow lives only inside an agent conversation. I can't see at a glance which Stage a Run is in, whether Check has looped, how far the Tickets are, or whether the agent is blocked waiting on me. With several Runs, or with the agent window out of sight, I miss the moments where a human is needed (a grill question, a Spec sign-off, a Check that hit its loop cap, the go-ahead to push a PR).

## Solution

A read-only Dashboard in the browser. The `factory` Skill keeps a Run record up to date as each Run moves through the Stages. A new `tds-factory dashboard` command serves those records on localhost, and a single web page shows every Run as a card on a board with one column per Stage plus Done. Cards show progress, Check verdicts and the loop count, and flag Runs that are waiting on me prominently, including in the browser tab title. Clicking a card shows the Markdown summaries the Run wrote for each Stage.

## User Stories

1. As a developer, I want the `factory` Skill to write a Run record for every Run, so that the Dashboard has something to read.
2. As a developer, I want the Run record updated at every Stage transition, so that the board never lags a whole Stage behind.
3. As a developer, I want a short activity note in the Run record (e.g. "implementing ticket #12"), so that I can tell what the agent is doing right now.
4. As a developer, I want each Run stored in its own folder named `YYYY-MM-DD-<slug-of-title>`, so that the id is readable and Runs never collide.
5. As a developer, I want several Runs to be shown at once, so that I can run the Factory on more than one piece of work.
6. As a developer, I want Run records kept in the project being built, not in the tds-factory repo, so that the state sits next to the work.
7. As a developer, I want `.factory/` to be gitignored in that project, so that status files don't end up in commits.
8. As a developer, I want to start the Dashboard with `tds-factory dashboard`, so that I don't need to install or run anything else.
9. As a developer, I want the Dashboard to serve the `.factory/` folder of my current directory, so that I see the Runs of the project I'm in.
10. As a developer, I want to change the port with `--port`, so that I can avoid a clash with another local service.
11. As a developer, I want the server to bind to localhost only, so that the private contents of my Runs aren't exposed to the network.
12. As a developer, I want the server to refuse to serve anything outside `.factory/`, so that a crafted URL can't read other files on my machine.
13. As a developer, I want the page to refresh by itself every 2 seconds, so that I can leave it open while a Run progresses.
14. As a developer, I want one card per Run, so that I can see each piece of work as one thing.
15. As a developer, I want columns for Define, Prepare, Build, Check, Finish and Done, so that I see where each Run is in the Flow.
16. As a developer, I want a card to show its title, activity note and agent, so that I can recognize it and see who is working on it.
17. As a developer, I want a card to show Ticket progress (e.g. 3/5), so that I know how far Build is.
18. As a developer, I want Standards and Spec chips on Check cards showing pass or fail, so that I see the outcome of the review at a glance.
19. As a developer, I want the Check loop count shown (e.g. "loop 1/2"), so that I know when the cap is near.
20. As a developer, I want Runs waiting on me to stand out on the board, so that I notice them at once.
21. As a developer, I want the reason a Run is waiting on me shown on the card, so that I know what it needs.
22. As a developer, I want the tab title to show how many Runs are waiting on me, so that I can notice it from another window.
23. As a developer, I want a "last updated" label on each card, so that I know how fresh the information is.
24. As a developer, I want that label to turn amber when a Run hasn't updated for a while, so that I can spot a crashed or stalled Run.
25. As a developer, I want a Run to be marked abandoned when I tell the agent to stop, so that it doesn't look like active work.
26. As a developer, I want finished Runs to move to the Done column with a link to the PR, so that I can find the result.
27. As a developer, I want Runs older than 7 days hidden behind a toggle, so that the board stays readable over time.
28. As a developer, I want nothing deleted from disk when Runs are hidden, so that history is kept.
29. As a developer, I want to click a card to read the Markdown summaries of the Run (define, build, check-N, finish), so that I can follow the details without opening files.
30. As a developer, I want the Spec and Tickets linked from a Run, not copied, so that there is one source of truth.
31. As a developer, I want the Dashboard to render a half-written, old or unknown-format record as a card anyway, so that a mid-write or a skill change doesn't blank the board.
32. As a developer, I want the Dashboard to be strictly read-only, so that it can't interfere with a running agent.
33. As a developer, I want the Run records to work the same under Claude, Codex and Copilot, so that the Dashboard doesn't care which agent ran the Factory.
34. As a developer, I want the record to say which agent wrote it, so that I can see it on the card.
35. As a developer, I want the page to need no build step, framework or CDN, so that it works offline and stays simple to maintain.

## Implementation Decisions

- **Run record writer: the `factory` Skill.** The Skill gains a rule to create the Run folder when the Factory starts and to update the Run record at every Stage transition and whenever it becomes blocked on or released from the human. The Skill owns the schema of the record, and it is documented in the Skill so every Agent target writes the same shape.
- **Run record contents:** title; current Stage; status (`running`, `waiting`, `done`, `abandoned`); `waiting_on_human` flag with a short reason; activity note; Check loop count (cap 2); Standards and Spec verdicts from the latest review; Ticket progress (done and total); links to the Spec, the Tickets and the PR; the writing agent's name; created and updated timestamps.
- **Waiting on a human** is set at: Define questions and Spec sign-off, Check after the loop cap with problems still open, and Finish before pushing the PR.
- **Stage summaries:** the Skill writes a short Markdown summary into the Run folder per Stage: define, build, one per Check pass, and finish. The Spec and Tickets are referenced by link only.
- **Abandoned:** the Skill sets it when the user says to stop. A Run that dies silently is not detected by the Skill; the Dashboard shows it as stale from the update timestamp.
- **Storage location:** the Run folders live in a `.factory/runs/` folder in the project being built, which should be gitignored. The Skill tells the user to add that ignore entry if it is missing.
- **Dashboard command:** a new `dashboard` command on the `tds-factory` CLI, with a `--port` option (default 4317). It serves the `.factory/` folder of the current directory and prints the URL.
- **Server module:** a deep module that, given a project directory and a port, starts an HTTP server bound to 127.0.0.1 with four routes: the page, a JSON list of all Run records, an info route that returns the project directory, and a file route for the Markdown files of a Run. The file route is confined to `.factory/` and rejects path traversal. The list route skips nothing that parses at all and tolerates unreadable or partial records by returning what it can with a flag, instead of failing the whole list.
- **Page:** one HTML file with inline CSS and JS, no framework, no build step, no CDN. It polls the list route every 2 seconds. Columns are the 5 Stages plus Done. Markdown is shown as preformatted plain text. It is read-only, with no buttons that change a Run.
- **Lenient reader:** the page treats every field as optional and ignores unknown fields. Missing fields render as blank or a neutral default.
- **Stale indicator:** the "last updated" label is derived from the update timestamp and turns amber past a threshold (about 10 minutes).
- **Done column and history:** Runs with status `done` or `abandoned` go to Done. Runs older than 7 days are hidden behind a "show older" toggle.
- **Packaging:** the page ships in the package's `files` list so `npm`-style installs include it.
- **Glossary:** Run, Run record and Dashboard are already in `GLOSSARY.md`. No ADR; the design is easy to change later.

## Testing Decisions

- **What makes a good test:** only external behavior through the server's HTTP interface. Tests do not look at internal functions, the page's DOM, or the wording of the Skill.
- **One seam:** the HTTP interface of the server module. A test starts the server on a random port over a temp project directory that holds fixture Run records, then makes requests.
- **Cases to cover:** the list route returns all valid Runs; a malformed or half-written record doesn't break the list and is flagged; a record with missing or unknown fields is returned; the file route returns a Run's Markdown file; the file route rejects `..` traversal, encoded traversal, absolute paths and paths outside `.factory/`; the server listens on loopback only; a missing `.factory/` folder gives an empty list, not an error.
- **Not automatically tested:** the HTML page and the `factory` Skill's prose. These are checked by hand by running a real Run and watching the board.
- **Prior art:** none; the repo has no tests yet. Use Node's built-in `node:test` runner, so no new dependency is added, and add a `test` script to `package.json`.

## Out of Scope

- Any control from the Dashboard: starting, approving, pausing or stopping Runs.
- Live streaming of agent output, hooks, or log parsing; the activity note is the only live signal.
- Reconstructing Runs from git, GitHub Issues or specs for work that didn't write a Run record.
- Rendering Markdown as formatted HTML.
- Authentication, remote access, or serving anything beyond localhost.
- Deleting or archiving Run folders.
- Per-reviewer chips beyond Standards, Spec and Security.

## Further Notes

- Inspired by the `software-factory-claude-code` example (a single `dashboard.html` polling per-job `job.json` files), but with Run (not "job") as the term, Node instead of Python for serving, and records written by the `factory` Skill since this Factory has no other place that keeps state.
- The Skill is installed by copy, so after changing it the user has to re-run `tds-factory install` for it to take effect.
