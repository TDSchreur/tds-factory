# Linked document hardening

Full track. Fixes the items [pull request #593](https://github.com/TDSchreur/tds-factory/pull/593) (Linked document titles, [Spec](linked-document-titles.md)) left open, plus the earlier-Run items its Check repeated. Decisions of the earlier Runs are in [ADR 0038](../adr/0038-the-dashboard-reads-only-the-documents-a-run-record-links-to.md), which this Run amends: a regular file of at most 1 MiB, and the Run worktree as a root only under the Project's `.factory/worktrees/`.

## Problem Statement

The Dashboard reads Linked documents of a Run and labels them with a title. The Check of #593 found gaps in four places:

- The Markdown parser behind every Dashboard Markdown view and behind the titles does not know `~~~` fences, takes a four-space indented line for a heading, keeps a closing `#` sequence in the heading text and gives an empty title for an empty first `# ` heading.
- The reader opens a listed path that is a FIFO, a device or a directory, has no size cap, trusts the `worktree` value of the Run record as a root, and leaves a gap between the path check and the read.
- Every poll locates every listed document of every Run, finished Runs included, and the title cache drops the entry that was stored first, not the one used least recently. The digit prefix has no length limit.
- A cut-off tile title shows in full only in the Run detail. The docs hide `<title>` in `"Spec: <title>"` because it is not in a code span, and the titles test, `DocLink` and the handler carry small leftovers.

## Solution

Fix each item. The parser follows CommonMark for the cases above. The reader refuses anything that is not a regular file of at most 1 MiB, opens without following a final symlink and confirms it opened the file it checked. The worktree counts as a root only under the Project's `.factory/worktrees/`. The located path is cached per Run, so a poll costs at most one `stat` per document. The tile tooltip carries the title and the path. The docs and the changelog are brought in line.

## User Stories

1. As a user, I want a `#` line inside a `~~~` fenced block ignored, so that a shell comment there is not taken for a title or a heading in any Markdown view.
2. As a user, I want a fence to close only on a fence of the same character that is at least as long, so that a `~~~` line inside a backtick block, or a shorter fence inside a longer one, does not end it early.
3. As a user, I want a line indented four or more spaces not to be a heading, so that indented code that starts with `#` stays code.
4. As a user, I want a closing `#` sequence removed from a heading (`# Title ##` reads "Title"), so that the label is clean.
5. As a user, I want `# Title#` and `# Title \#` to keep their `#`, so that only a real closing sequence is removed.
6. As a user, I want a first `# ` heading that is empty (`# `, `# #`) skipped for the next non-empty level 1 heading within the first 4 KB, so that a blank title does not hide a real one.
7. As a user, I want a tab after `#` to stay a valid heading, so that `#<tab>Title` still works.
8. As a user, I want the file name as label when no non-empty level 1 heading exists, so that a link is never blank.
9. As a user, I want a number from the file name limited to 1 to 6 digits, so that a long digit name cannot fill the label.
10. As a user, I want a Ticket tile with a title to show `"<title> (<path>)"` as its tooltip, so that a cut-off title is readable on the board.
11. As a developer, I want the document route and the titles to refuse a FIFO, a device and a directory, and to fall through to the next root, so that the reader never blocks on or reads a special file.
12. As a developer, I want the document route to answer 404 for a file above 1 MiB, so that a huge Markdown file cannot be loaded into the Dashboard.
13. As a developer, I want the file opened without following a final symlink and checked after opening against the file I located, so that a swap between check and read cannot read another file.
14. As a developer, I want the Run worktree used as a root only when the record's `worktree` is absolute and its real path is under the Project's `.factory/worktrees/`, so that a hand-edited record cannot point the reader elsewhere. The main checkout is still used.
15. As a developer, I want the located path cached per Run and dropped when the record's `updated` changes, so that a poll costs at most one `stat` per document, finished Runs included.
16. As a developer, I want the title cache to drop the least recently used entry, so that a hot title is not evicted by a burst of new ones.
17. As a developer, I want `titles` attached in the view module and not in the handler, so that the handler stays free of Run view logic.
18. As a developer, I want a temp-dir helper in the titles test and no dead fallback in `DocLink`, so that the code stays small.
19. As a reader of the docs, I want `"Spec: <title>"` and `"Ticket: <title>"` in code spans and the Linked documents paragraph split into a short list, so that `<title>` is not hidden by a renderer and the text is scannable.

## Implementation Decisions

- **Fences (`dashboard/markdown.js`).** An opening fence is 3 or more backticks or tildes, after any indentation, with an optional info string (a backtick fence info string holds no backtick). It closes on a line of only the same character, at least as long as the opener, with trailing spaces only. An unclosed fence runs to the end of the text, as now. Any indentation is still accepted on a fence line (lenient: it hides more, never less). The rule applies to backtick fences too.
- **Headings.** `#` to `######` after at most 3 spaces of indent, then a space or tab, or nothing (an empty heading). A closing sequence is a run of `#` preceded by a space or tab (or the whole content) and followed only by spaces and tabs; it is removed. A `#` preceded by anything else, including a backslash, stays. A backslash escape is not otherwise interpreted by this parser; `# Title \#` keeps `\#` as text, as before.
- **Title rule.** The first level 1 heading with non-empty plain text within the first 4 KB, outside fenced code. None: no title, and the label is the file name. The digit prefix is 1 to 6 digits followed by `-`; more digits give no prefix.
- **Reader lookup (`src/run-folder.js`).** `locateInside` returns a path only when the target is a regular file; a directory, FIFO, device or socket gives null and the lookup falls through to the next root, then to the archive path for a Spec. A refusal stays a null/404 like every other.
- **Open and size.** `readLinkedDocument` and the title head read both go through one `openLinkedFile(path)`: `lstat` is not trusted. It opens with `fs.constants.O_RDONLY | O_NOFOLLOW` (and `O_NONBLOCK`, so a FIFO swapped in cannot block the open), calls `handle.stat()`, and refuses unless the opened file is a regular file, at most 1 MiB, and has the same `dev` and `ino` as `stat` of the located real path taken just before. Windows has no `O_NOFOLLOW` (`fs.constants.O_NOFOLLOW` is undefined there): the flag is 0, and the `dev`/`ino` comparison after `realpath` is the only guard; a swap there is limited to a file under the same roots. `ino` is read as `bigint` so large Windows file indexes compare exactly.
- **Size cap.** The document route refuses above 1 MiB (404). The title head reads at most 4 KB of a file of any size, so it needs no cap.
- **Worktree root.** The record's `worktree` is a root only when it is an absolute path whose real path is inside the real path of `<projectDir>/.factory/worktrees/`. Otherwise it is skipped with no error; the main checkout and the archive path still apply. ADR 0038 is amended in this Run (already written).
- **Located-path cache.** A per-Run map from the Run id to `{ updated, paths }`, with the located real path per listed document. A hit costs one `stat` per document (also confirms it is still a regular file there); a failed `stat` or a changed `updated` relocates. Finished Runs keep titles. The route does not use the cache. Accepted trade-off: a listed file that appears in the worktree after the main checkout copy was located shows its title after the Run record next changes (`updated` moves with every activity).
- **Title cache.** The existing cache keyed on real path, size and modification time becomes least recently used: a hit moves the entry to the end. The bound stays 500.
- **Tooltip (`dashboard/components.js`).** Always `"<title> (<path>)"` on a Ticket tile that has a title, and the path alone without one. Always, not only when cut off, because the cut-off is a CSS effect the script cannot see without measuring, and the same text on every titled tile is simpler to test. The Run detail links keep the path as tooltip: the full title is already the link text there.
- **View module.** `src/dashboard-pr-views.js` merges `titles` into the Run view; `src/dashboard-handlers.js` stops doing it. `DocLink` loses its unused children fallback. The titles test gets one temp-dir helper.
- **Build or borrow.** Node built-ins, no dependency: `fs.constants.O_NOFOLLOW`/`O_NONBLOCK`, `fs.promises.open`, `FileHandle.stat` (with `bigint`), `Stats.isFile`, `realpath`. Hand-rolled, so each needs the adversarial tests below: the fence tracker, the ATX heading and closing-sequence rule in `parseMarkdown`, the `dev`/`ino` check-to-read comparison, the worktree root rule and the located-path cache.
- **Documents (swept with `run sweep`, terms `fence`, `Linked document`, `tooltip`, `O_NOFOLLOW`, `ticketLabel`, `regular file`).** Bring in line: `docs/dashboard.md` (the Linked documents paragraph, split into a list, `Spec: <title>` in code spans, the 1 MiB cap, the worktree root, the Ticket tile tooltip); `docs/specs/linked-document-titles.md` (code spans, the title rule, the digit prefix, the tooltip); the changelog fragment `changelog.d/linked-document-title-as-link-text.md` (still unreleased: code spans) and one new fragment `changelog.d/linked-document-hardening.md`; `docs/adr/0038-the-dashboard-reads-only-the-documents-a-run-record-links-to.md` (amended). Read and unchanged: `GLOSSARY.md` (Linked document), `docs/specs/readable-linked-documents.md` (history), `dashboard/help.js` (does not describe titles or tooltips), the canonical specs that mention other tooltips (`dashboard-progress`, `dashboard-responsive-usability`, `token-usage`).

## Size estimate

Counted as the Run size counts (no lockfiles, no fixtures), tests at real size, Markdown by line length. Estimates run low.

| Row                                                                | Files                                                                                                                      | KB       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| Ticket 1: parser and title rules                                   | 4 (markdown.js, run-folder.js, test/dashboard-markdown.test.js, test/dashboard-titles.test.js)                             | 5.5      |
| Ticket 2: reader hardening, worktree root, located-path cache, LRU | 4 (run-folder.js, run-store.js, test/dashboard-documents.test.js, test/dashboard-titles.test.js)                           | 9.0      |
| Ticket 3: tooltip and code tidy                                    | 6 (dashboard-pr-views.js, dashboard-handlers.js, components.js, test/dashboard-tickets.test.js, browser test, titles test) | 4.0      |
| Ticket 4: documentation                                            | 4 (docs/dashboard.md, linked-document-titles.md, one edited and one new changelog fragment)                                | 3.5      |
| ADR 0038 amendment and Define artifacts (this Spec)                | 2                                                                                                                          | 9.5      |
| **Total (distinct files)**                                         | **17**                                                                                                                     | **31.5** |

Over the fit line (10 files, 27 KB): 7 files and 4.5 KB over, and the file count is above the Run limit (about 15 files, 40 KB), so Build may wait for the user. The files overlap across Tickets; 17 counts each once. The browser test file is likely unchanged, which would make it 16. Suggested cut, for the coordinator to decide (this Spec is not split): Run 1 carries Tickets 1, 2 and 4 (about 12 files, 27.5 KB), Run 2 carries Ticket 3 (tooltip and tidy, about 6 files, 4 KB) with its own docs line. Not applied.

## Testing Decisions

A good test checks external behavior: the title and tooltip a user sees, the status of the route and the labels the server sends; not which helper ran. Follow the reliable-tests guide: temp folders per test, no fixed waits, POSIX-only cases skipped on Windows with a stated reason.

- **Seam 1, the parser** (`parseMarkdown`, pure; `test/dashboard-markdown.test.js`). Adversarial cases:
  - tilde fences: nested (`~~~` inside a backtick block, a backtick line inside a `~~~` block), unclosed to the end of the text, a closer shorter than the opener, a closer of the other character, a closer with trailing text, mixed backtick and tilde blocks one after another, a fence with an info string;
  - indented headings: 3 spaces is a heading, 4 spaces and a tab-indent are not;
  - closing hashes: `# Title ##`, `# Title #`, `# #`, `# ##`, `#`, `# Title#`, `# Title \#`, `# Title # x`, a closing sequence followed by spaces or a tab;
  - a tab after `#`; `#hashtag`; more than six `#`.
- **Seam 2, the server reader and the titles** (`createLinkedTitles`, `readLinkedDocument`, the document route; `test/dashboard-documents.test.js`, `test/dashboard-titles.test.js`): a temporary Project with a Run record, a worktree and files. Cases:
  - title: empty first heading gives the next non-empty one; all headings empty gives the file name; a 7-digit prefix gives none, 6 digits give one;
  - special files: a directory, a FIFO (`mkfifo`, POSIX only; the test must not hang) and, where it cannot be created, a device through a stubbed `FileHandle.stat` result; each is refused and falls through to the main checkout copy;
  - size: a file of exactly 1 MiB opens, 1 MiB plus 1 byte gives 404, and the title of a large file still comes from its first 4 KB;
  - symlink swap: the open step is injectable, as `read` is; a test replaces the located file with a symlink to an outside file, and with a different file of the same name, between the check and the open, and expects a refusal;
  - worktree root: absolute under `.factory/worktrees/` is used; a relative path, an absolute path outside, a path inside whose real path leaves through a symlink, and a non-string value are skipped while the main checkout still serves the document;
  - located-path cache: a second poll with an unchanged record stats and does not re-locate (counted through an injectable locate); a changed `updated` relocates; a deleted file relocates; a finished Run keeps its title;
  - LRU: a hit survives a burst of new entries past the bound that would have evicted it under first-in-first-out; the bound holds.
- **Seam 3, the page** (`test/dashboard-tickets.test.js` and the browser fixture): a titled tile has the tooltip `"<title> (<path>)"`, an untitled tile the path alone, a Run detail link the path, HTML in a title shows as text. The browser test changes only if its existing assertions fail.
- Prior art: `test/dashboard-titles.test.js`, `test/dashboard-documents.test.js`, `test/dashboard-markdown.test.js`.
- Verify-fast after each Ticket is `npm run test:unit`; `npm run test:browser` runs because the Dashboard changes.

## Out of Scope

- Backslash escapes and other inline Markdown the parser does not know; Setext headings; front matter.
- Titles for remote (GitHub and Azure DevOps) Tickets.
- Caching on the document route; a general file route; relative links inside a Linked document.
- Protection against a swap on Windows beyond the `dev`/`ino` comparison.

## Further Notes

- Origin: [pull request #593](https://github.com/TDSchreur/tds-factory/pull/593), the Left open table of its Check. The Follow-up after Finish keeps its own pull request feedback scope and does not extend this Spec.
- `parseMarkdown` is shared by the page renderer and the server titles, so the fence and heading changes show in every Markdown view of the Dashboard; the changelog says so.
