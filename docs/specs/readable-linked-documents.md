# Readable Linked documents in the Dashboard

Full track. Decisions are recorded in [ADR 0037](../adr/0037-the-dashboard-reads-only-the-documents-a-run-record-links-to.md) and in the glossary entry Linked document.

## Problem Statement

In the Run detail of the Dashboard, the Spec and the Tickets of a Local tracker show as plain text such as `Spec: docs/specs/x.md` or `Ticket: .scratch/x/issues/01-a.md`. The user cannot click them and has to open the file elsewhere. The Ticket tiles on the board have the same gap. GitHub Tickets already open as links, so the Dashboard is readable for one tracker and not for the other.

## Solution

A Linked document that is a path (not an http(s) URL) becomes a link that opens inside the Run detail, rendered as Markdown, with a Back button to the Run view. The link text is the file name, and the full path is the tooltip. Showing the document's title instead is cut to a later Run ([#574](https://github.com/TDSchreur/tds-factory/issues/574)). The same holds for the Ticket tiles on the board: a click opens the Run detail on that document. http(s) links keep their current behavior and labels. A document that is no longer on disk shows a message with its path.

## User Stories

1. As a user of the Local tracker, I want to click the Spec in the Run detail, so that I read it without leaving the Dashboard.
2. As a user of the Local tracker, I want to click a Ticket in the Run detail, so that I read its scope and blocking edges there.
3. As a user, I want the Ticket tiles on the board to open the Ticket, so that I get from the card to the text in one click.
4. As a user, I want a Back button in the opened document, so that I return to the Run view where I was.
5. As a user, I want the file name as link text instead of the full path, so that the list of Tickets is short to scan.
6. As a user, I want the document's title as link text, so that I recognize a Ticket without decoding a file name (later Run, [#574](https://github.com/TDSchreur/tds-factory/issues/574)).
7. As a user, I want the full path as tooltip on the link, so that I still see which file it is.
8. As a user, I want the document rendered as Markdown like the Run files, so that headings, lists and code read well.
9. As a user, I want GitHub and Azure DevOps Ticket links to keep opening in a new tab with their current labels, so that nothing changes for remote trackers.
10. As a user, I want the Spec to open from `docs/specs/archive/` after the Run shipped and the Spec was moved, so that a finished Run stays readable.
11. As a user, I want a Ticket that was removed from `.scratch/` to say "This Ticket is no longer on disk" with its path, so that I know why nothing shows.
12. As a user, I want the same message for a Spec that exists nowhere, so that a broken link is explained and not blank.
13. As a user, I want a document found in the Run worktree to win over the main checkout, so that I read the version the Run is working on.
14. As a user, I want a document that only exists in the main checkout (for example after the worktree was cleaned) to still open, so that a finished Run keeps its Spec.
15. As a user, I want the opened document reachable by keyboard and announced to a screen reader, so that the Dashboard stays accessible (WCAG 2.2 AA).
16. As a user, I want focus to return to the link I used after Back, so that I do not lose my place.
17. As a developer, I want the server to read only paths listed in that Run's `spec_link` or `tickets`, so that the Dashboard is not a general file reader (ADR 0037).
18. As a developer, I want paths outside the Run worktree and the main checkout, absolute paths, `..` paths, non-Markdown files, unlisted paths and encoded separators answered with 404, so that a hostile page cannot read other files of a Project.
19. As a developer, I want a symlink that leads outside both folders refused, so that a link in the repo cannot leak a file.
20. As a developer, I want the new route to be read-only and to need no session token, like `/files`, so that it adds no write surface.
21. As a developer, I want relative links inside a Linked document to stay plain text, so that the first version needs no link resolver (Left open).

## Implementation Decisions

- **Route.** A new read-only route, `GET` and `HEAD`, scoped to a Project like the Run file route, takes the Run id and one path and returns the Markdown body. A 404 with the same body for every refusal (unknown Run, unlisted path, bad path, missing file), so that the answer does not tell which check failed.
- **Allow-list.** The path must be, byte for byte after one decoding, an entry of that Run's `spec_link` or `tickets`. Entries that are http(s) URLs never match. This is the main defense; the checks below are a second layer.
- **Path validation, build or borrow.** Borrow the Node built-ins; add no dependency. The path must be relative, contain no `\`, no NUL, no `..` segment and end in `.md`. It is resolved against each root in turn, `realpath` follows symlinks, and the result must stay inside the realpath of that root (compared with a trailing separator, as the Run file reader does). The decoding happens once; a path that still holds an encoded separator after decoding fails the allow-list. Because this is hand-rolled, an adversarial test is required (see Testing Decisions).
- **Lookup order.** Run worktree, then the main checkout (the Project root), then, for the Spec only, `docs/specs/archive/<same file name>` in the main checkout. The first file found is served. Roots are taken from the Run record's `worktree` and the Project path, never from the request.
- **Titles are a later Run.** [#574](https://github.com/TDSchreur/tds-factory/issues/574) adds the title per Linked document to the Run view data; this Run only shows the file name.
- **Link text.** Local path: the file name; the path is the `title` attribute. Remote URL: as before (`Spec: <url>`, `#123`).
- **Opening.** The drawer state gains an open document (path). Opening a document fetches the body from the new route and renders it with the existing Markdown component; Back clears it and returns focus to the link. A Ticket tile click opens the Run detail directly on its document. While the body loads the drawer shows a loading line; a 404 shows "This Ticket is no longer on disk" (or "This Spec ...") and the path.
- **Run view data.** Local paths and URLs stay in the same lists; the page tells them apart by the existing http(s) check, not by a stored tracker type. No change to the Run record schema.
- **Documents (swept with `run sweep`, terms `spec_link`, `safeUrl`, `/files`, `plain text`, `Ticket tile`, `Linked document`).** Bring in line: the Dashboard guide (route table, Run detail text), the Dashboard help text, `skills/factory/SKILL.md` and `skills/factory/references/run-schema.md` only where they describe `spec_link` and `tickets` as shown (check, likely unchanged), the glossary and ADR 0037 (already written in Define). The canonical Dashboard Markdown spec is archived (`dashboard-markdown-view`), so it stays as history. A changelog fragment is required.

## Size estimate

Counted as the Run size counts (no lockfiles, no fixtures), tests at real size, Markdown by line length. Estimates run low.

| Row | Files | KB |
| --- | --- | --- |
| Ticket 1: document route, lookup, allow-list and adversarial tests | 4 (run-folder.js, dashboard-handlers.js, dashboard-routes.js, one new test file) | 8.5 |
| Ticket 2: open in the drawer, Back, not-on-disk message, tile click, browser test | 3 (components.js, model.js, browser test; the test file is new to the diff) | 7 |
| Ticket 3: documentation (Dashboard guide, help text, changelog fragment) | 3 (docs/dashboard.md, dashboard/help.js, changelog fragment) | 2.5 |
| Define artifacts (this Spec, glossary, ADR 0037) | 3 | 13 |
| **Total** | **12** | **31** |

The limit for fitting is 10 files and 27 KB (two thirds of the Run size limit). The user split the work: this Run carries the route, the opening in the drawer and the documentation, with the file name as link text; the titles move to a later Run ([#574](https://github.com/TDSchreur/tds-factory/issues/574)). The total is still above the fit line, mostly from the Define artifacts, and stays under the Run size limit (15 files, 40 KB).

## Testing Decisions

A good test checks external behavior: the HTTP answer for a path, the text and attributes the user sees, and what a click leads to; it does not check which helper was called.

- **Seam 1, the HTTP route** (highest seam, like the existing `/files` tests in the Dashboard server tests): start the Dashboard against a temporary Project with a Run record, a worktree folder and files, and request the route. Covers: Spec and Ticket found in the worktree, found only in the main checkout, Spec found in `docs/specs/archive/`, missing everywhere (404), worktree winning over the main checkout, HEAD. Adversarial cases, each expecting 404 and no body: `../` and nested `a/../../x.md`, an absolute path, a Windows path with `\`, a symlink inside the Project that points outside it, a non-`.md` file, a `.md` path not listed in `spec_link` or `tickets`, a listed URL, `%2e%2e%2f`, `%2f`, `%5c` and a double-encoded separator, a NUL byte, an unknown Run id, and a Run of another Project. Follow the reliable-tests guide: temporary folders, no fixed ports, symlink case skipped with a stated reason where the platform cannot create one.
- **Seam 2, the Dashboard browser fixture** (existing browser tests): a Run with a local Spec and Ticket; assert link text is the file name with the path as tooltip, a click shows the rendered document with a Back button, Back restores the Run view and focus, the no-longer-on-disk message, a Ticket tile click opens the document, and an http(s) Ticket stays an anchor with its old label. The existing assertion of `Spec: docs/specs/x.md` as text is updated.
- Prior art: the Run file route tests in the Dashboard server tests, `test/dashboard-tickets.test.js` for tile labels, `test/dashboard-markdown.test.js` for rendering.
- Verify-fast after each Ticket is `npm run test:unit`; the browser test runs with `npm run test:browser` because the Dashboard changes.

## Out of Scope

- Relative links inside a Linked document (they stay plain text; Left open).
- Linked documents that are not Markdown, and files outside the Spec and Tickets.
- Editing a document in the Dashboard.
- Rendering the body of a remote (GitHub or Azure DevOps) Ticket.
- A stored tracker type in the Run record.
- The PR link and the Run files, which keep their behavior.

## Further Notes

- The Follow-up after Finish has its own scope (PR feedback) and does not extend this Spec.
- A Local tracker keeps Tickets under `.scratch/`, which stays out of git; the route reads them from disk, so a Run whose `.scratch/` was removed shows the no-longer-on-disk message.
