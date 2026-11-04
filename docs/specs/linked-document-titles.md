# Linked document titles in the Dashboard

Full track. Split off from [readable Linked documents](readable-linked-documents.md) ([GitHub issue #574](https://github.com/TDSchreur/tds-factory/issues/574)). Decisions of that Run are in [ADR 0038](../adr/0038-the-dashboard-reads-only-the-documents-a-run-record-links-to.md) and in the glossary entry Linked document.

## Problem Statement

A Spec or Ticket of a Local tracker shows in the Run detail and on the Ticket tiles as its file name, such as `01-skeleton.md` or `linked-document-titles.md`. The user has to decode the name to recognize the Ticket, while the first line of the file already says what it is.

## Solution

The link text of a local Linked document is the title of the document: its first level 1 heading with text (an empty `# ` heading is skipped). A file name that starts with 1 to 6 digits and a `-` keeps its number in front, so `01-skeleton.md` with the heading `# Skeleton and gh wrapper` reads "01 Skeleton and gh wrapper". The Spec and Ticket links in the Run detail read `"Spec: <title>"` and `"Ticket: <title>"`, and the Ticket tiles show the title, cut off with an ellipsis when it is too long. The Ticket tile tooltip is `"<title> (<path>)"` and the other links keep the full path as tooltip, and the opened document keeps the file name as its heading. A document that is not on disk, or has no such heading, keeps showing the file name. GitHub and Azure DevOps links keep their labels.

## User Stories

1. As a user, I want the Spec link in the Run detail to show the Spec's title, so that I know what the Run builds without opening it.
2. As a user, I want each Ticket link in the Run detail to show the Ticket's title, so that I recognize a Ticket without decoding a file name.
3. As a user, I want the Ticket tiles on the board to show the title, so that the card reads as a list of work.
4. As a user, I want a long title on a tile cut off with an ellipsis, so that the card does not grow or wrap into a wall of text.
5. As a user, I want the path in the tooltip (`"<title> (<path>)"` on a Ticket tile), so that I still see which file a link is.
6. As a user, I want the number from a file name such as `01-skeleton.md` in front of the title, so that I see the order of the Tickets.
7. As a user, I want a file without a level 1 heading, or no longer on disk, to show its file name, so that a link is never blank.
8. As a user, I want a heading with code, emphasis or a link to show as plain text, so that the label is not cluttered with Markdown marks.
9. As a user, I want a `#` line inside a fenced code block to be ignored, so that a shell comment is not taken for the title.
10. As a user, I want the opened document's heading to stay the file name, so that I see which file I am reading.
11. As a user, I want GitHub and Azure DevOps Tickets to keep their labels, so that remote trackers behave as before.
12. As a user, I want the Spec to show its title after it moved to `docs/specs/archive/`, so that a finished Run stays readable.
13. As a user, I want a title that changes on disk to show on the next refresh, so that the board does not show an old name.
14. As a developer, I want the titles in the Run view data from the server, so that the page fetches nothing extra to label links.
15. As a developer, I want a file re-read only when its size or modification time changes, so that a Dashboard that refreshes often does not read every Ticket every time.
16. As a developer, I want that cache bounded, so that a long-running Dashboard does not grow without limit.
17. As a developer, I want the title lookup to use the same path checks as the document route, so that titles are no way around ADR 0038.
18. As a developer, I want a hostile file (a huge line, no newline, NUL bytes, HTML in the heading) to give a safe label or the file name, so that a Linked document cannot break or script the Dashboard.

## Implementation Decisions

- **Title rule.** The first ATX heading of level 1 (`# `, a space or tab after the `#`) with text in the first 4 KB of the file, outside fenced code blocks; an empty `# ` heading is skipped and a closing `#` sequence is removed. Setext headings and other levels do not count. No such heading in those 4 KB means no title. The title is trimmed and has control and format characters replaced by a space; a very long title is cut at a fixed length on the server.
- **Inline Markdown.** Code, emphasis and links in the heading become their plain text. The label is a string; the page renders it as text and never as HTML.
- **Number from the file name.** When the file name starts with digits followed by `-`, the label is the digits, a space and the title. Without a title the label stays the file name.
- **Where the title shows.** The Spec link and Ticket links in the Run detail (`"Spec: <title>"`, `"Ticket: <title>"`), and the Ticket tiles. The title is the link text; the Ticket tile tooltip is `"<title> (<path>)"` (see [Linked document hardening](linked-document-hardening.md)), the other links keep the full path, and the opened document's heading stays the file name. Remote (http(s)) links keep their labels and carry no title. Not found or no heading: the file name, as today.
- **Lookup.** The same resolution as the document route: the allow-list of that Run's `spec_link` and `tickets`, the path checks, the Run worktree before the main checkout, and `docs/specs/archive/` for the Spec; the reader refuses what is not a regular file of at most 1 MiB and takes the worktree only under `.factory/worktrees/` ([Linked document hardening](linked-document-hardening.md)). The lookup is extracted so that the route and the titles share one implementation and cannot drift; the titles add no new way to a file.
- **Titles in the Run view data.** The server adds the title per local Linked document to the Run view, keyed by the listed path. The page labels links from that data and fetches nothing extra. The Run record schema does not change.
- **Cache.** Keyed on the resolved path, size and modification time; a file is re-read only when one of them changes. The cache has a fixed maximum number of entries and drops the oldest first. A missing file is not cached as a title.
- **Build or borrow, the heading parser.** Borrow: the Dashboard's own Markdown parser (`parseMarkdown`) takes no DOM and imports nothing, so the server imports it and runs it on the first 4 KB. It already knows fenced code, headings and inline spans, so the title is the plain text of the first level 1 heading block it returns. This keeps one definition of "heading" for the page and the label. If the parser cannot meet the title rule (for example it accepts a `#` without a following space, or takes a Setext heading as level 1), the Ticket adds a small hand-rolled line scanner for the rule above instead and says so in its commit; either way the adversarial tests below are required. No dependency is added.
- **Documents (swept with `run sweep`, terms `file name`, `link text`, `tooltip`, `Linked document`, `ticketLabel`).** Bring in line: the Dashboard guide's Linked documents section and the Ticket tile paragraph (`docs/dashboard.md`), the Dashboard help text "Specs and Tickets" (`dashboard/help.js`), the glossary entry Linked document (read; likely unchanged) and ADR 0038 (read; unchanged, the decision does not change). `docs/specs/readable-linked-documents.md` stays as history of the previous Run. The canonical specs that mention tooltips (`dashboard-progress`, `dashboard-responsive-usability`, `token-usage`) describe other tooltips and stay. A changelog fragment is required.

## Size estimate

Counted as the Run size counts (no lockfiles, no fixtures), tests at real size, Markdown by line length. Estimates run low.

| Row                                                                  | Files                                                                                                                        | KB       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------- |
| Ticket 1: titles in the Run view data (lookup, parser, cache, tests) | 3 (run-folder.js, dashboard-pr-views.js, test/dashboard-documents.test.js)                                                   | 7.5      |
| Ticket 2: link text and tiles, docs and changelog fragment           | 8 (model.js, components.js, style.css, help.js, docs/dashboard.md, changelog fragment, dashboard-tickets test, browser test) | 7.5      |
| Define artifacts (this Spec)                                         | 1                                                                                                                            | 11.5     |
| **Total**                                                            | **12**                                                                                                                       | **26.5** |

The fit line is 10 files and 27 KB (two thirds of the Run size limit). The KB total fits; the file count is two over, because the client change touches the page, the style, the help text, the guide and two tests. The browser test file may need no change if the existing assertions already hold for a file without a heading, which would make it 11. The total stays under the Run size limit (15 files, 40 KB). With only two Tickets there is no extra documentation Ticket; each Ticket updates the documents it touches.

## Testing Decisions

A good test checks external behavior: the label text and tooltip a user sees, and the Run view data the server sends; not which helper ran.

- **Seam 1, the server's Run view data** (the highest seam on the server, next to the existing document route tests): a temporary Project with a Run record, a worktree and files. Cases: title from the worktree, from the main checkout and from `docs/specs/archive/`; digits prefix (`01-x.md`); no heading and missing file give no title; a title that changes when the file changes (size or mtime) and a file that is not re-read when neither changed; the cache stays within its bound; remote URLs carry no title; a path the Run does not list gets none.
- **Adversarial cases** (the parser and the path are untrusted input; follow the reliable-tests guide). Each expects a safe label or no title and no crash: a line far longer than 4 KB; 4 KB with no newline; a `#` heading inside a fenced code block, and a fence left open at the 4 KB cut; `#` without a space, `#hashtag`, and `##` and Setext headings; CRLF line endings; NUL and other control characters in the heading; a very long title (cut); HTML such as `<img src=x onerror=alert(1)>` and `<script>` in the heading, which reaches the page as text; inline code, emphasis and a link in the heading; and a symlink leading outside both roots, which gives no title like the route does.
- **Seam 2, the page** (existing `ticketsOf` and Ticket tile tests, and the Dashboard browser fixture): link text `"Spec: <title>"` and `"Ticket: <title>"`, the tooltip is `"<title> (<path>)"` on a tile and the path elsewhere, a tile shows the title and a long title is truncated by CSS without wrapping, the opened document's heading is the file name, a link with no title shows the file name, and an http(s) Ticket keeps its label. HTML in a title shows as text.
- Prior art: `test/dashboard-documents.test.js`, `test/dashboard-tickets.test.js`, `test/dashboard-page-browser.test.js`.
- Verify-fast after each Ticket is `npm run test:unit`; `npm run test:browser` runs because the Dashboard changes.

## Out of Scope

- Titles for remote (GitHub and Azure DevOps) Tickets.
- Setext headings, headings below level 1, and front matter titles.
- Changing the opened document's heading, the route, or the allow-list.
- A stored title in the Run record.
- Relative links inside a Linked document.

## Further Notes

- The Follow-up after Finish has its own scope (PR feedback) and does not extend this Spec.
- Parent scope issue: [#574](https://github.com/TDSchreur/tds-factory/issues/574). It carries no Ticket label; the Tickets of this Run reference it.
