# Dashboard Markdown view

## Problem Statement

When I click a Run card on the Dashboard, the detail panel shows each Run file (`define.md`, `build.md`, `check-N.md`, `finish.md`, `pr.md`) as raw text in a `<pre>` block. Headings, lists, tables and code fences show as Markdown symbols, so the summaries are hard to read.

## Solution

The detail panel renders each Run file as formatted Markdown: headings, paragraphs, lists, emphasis, code, links, block quotes and tables. The renderer lives in the Dashboard page itself, adds no dependency and loads nothing from the network. It never inserts file content as HTML, so a Run file cannot inject markup.

## User Stories

1. As a developer watching a Run, I want headings in a Run file shown as headings, so that I can scan a summary
2. As a developer, I want bullet and numbered lists shown as lists, so that findings read one per line
3. As a developer, I want bold, italic and inline code styled, so that emphasis and identifiers stand out
4. As a developer, I want fenced code blocks shown in a monospace block that keeps its line breaks, so that diffs and test output stay readable
5. As a developer, I want Mermaid fences shown as code blocks, so that `pr.md` does not break
6. As a developer, I want tables shown as tables, so that verdicts and Run fields line up
7. As a developer, I want block quotes shown as quotes, so that quoted text is set apart
8. As a developer, I want http(s) links to be clickable and to open in a new tab, so that I can reach the PR and Tickets
9. As a developer, I want links with any other scheme (for example `javascript:`) shown as plain text, so that a Run file cannot run script
10. As a developer, I want HTML in a Run file shown as text, so that a Run file cannot inject markup
11. As a developer, I want Markdown I did not expect shown as plain text, not dropped, so that no content is lost
12. As a developer, I want the rendering to follow the light and dark theme, so that it stays readable in both
13. As a developer, I want a file that fails to load to keep showing its error message, so that I know why it is empty
14. As a developer, I want the panel not to flicker on each poll, so that scrolling and selection stay put
15. As a maintainer, I want no new dependency and no network resource, so that the Dashboard keeps working offline

## Implementation Decisions

- The Markdown renderer is a pure function in its own script block of the Dashboard page. It turns Markdown text into a plain tree of blocks and inline spans, with no DOM access. The existing page script builds DOM nodes from that tree with `textContent`, never `innerHTML`.
- Supported blocks: headings, paragraphs, bullet and numbered lists, fenced code blocks, block quotes, tables, horizontal rules. Supported inline: bold, italic, inline code, links.
- Link targets pass through the same http(s)-only rule the page already applies to other links. Other targets render as text.
- Raw HTML, images and nested structures beyond one level of list nesting are not interpreted and show as text.
- The Run file loading, polling and error behavior stay as they are. Only the way a loaded file is displayed changes.
- Run files stay plain Markdown on disk, and there is no raw-text toggle.

## Testing Decisions

- A good test checks external behavior: given Markdown text, what block and inline tree comes out, and that dangerous input is inert.
- The seam is the renderer function. A test extracts its script block from the Dashboard page and runs it in a `node:vm` context, then asserts on the tree. This needs no browser.
- Prior art: `test/dashboard-design.test.js` reads `dashboard.html` as text and asserts on it; `test/dashboard-dialog-browser.test.js` drives it in a browser when one is installed.
- Cases: each supported block and inline form, a `javascript:` link, embedded HTML, an unterminated code fence, empty input.

## Out of Scope

- A raw-text toggle or a copy button
- Syntax highlighting inside code blocks
- Rendering Mermaid diagrams or images
- Server-side changes
- Any Markdown feature beyond the list above

## Further Notes

The Glossary needs no change.
