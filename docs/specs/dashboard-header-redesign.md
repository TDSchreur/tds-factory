# Dashboard header redesign

## Problem Statement

The Dashboard header is a plain row of text. The title, the full project path and the update time all share one muted style, so nothing leads. The path is long and takes the space the rest of the header needs. The controls sit at the far right with a loose "Theme" label.

## Solution

The header has a left side and a right side. The left shows the title `tds-factory` in bold with a smaller muted "dashboard" label, then the project as a pill. The pill shows the folder name in monospace, and the full path appears on hover. A long name is cut with an ellipsis instead of wrapping. The right side holds the update status, the theme select and the older-Runs button. The status has a small dot: green while the data is live, red when the server cannot be reached. The separate "Theme" text label goes away, and the select keeps an accessible name. On a narrow screen the header wraps into two rows: title and status on the first, the project pill and the controls on the second. Only the look and arrangement change. No new information is added.

## User Stories

1. As a developer, I want the title to stand out, so that I can see which tool this is at a glance
2. As a developer, I want the project shown as its folder name, so that I can tell which project I am looking at without reading a long path
3. As a developer, I want the full project path on hover, so that I can still see exactly which directory the Dashboard serves
4. As a developer, I want a very long project name cut with an ellipsis, so that it never pushes the controls onto another row
5. As a developer, I want a status dot that is green when the data is live and red when the server cannot be reached, so that I see the connection state without reading text
6. As a developer, I want the "Updated" time and the existing error message kept, so that I lose no information
7. As a developer, I want the theme select and the older-Runs button grouped on the right, so that the controls are in one place
8. As a screen reader user, I want the theme select to keep an accessible name, so that removing the visible label does not hide its purpose
9. As a developer on a narrow screen, I want the header to wrap into two tidy rows, so that nothing overflows
10. As a developer, I want the header to stay sticky and keep working in light and dark themes, so that it behaves as before
11. As a maintainer, I want the element ids `project`, `status`, `theme` and `older` kept, so that the existing tests and code keep working

## Implementation Decisions

- The header component and the header rules in the stylesheet change. No other component, no server route and no data changes.
- The project pill's text is the last segment of the project path, whichever separator the path uses. Its tooltip is the full path. An empty path shows nothing.
- The status dot is drawn by the stylesheet, so the status text and its `error` class stay exactly as they are.
- The visible "Theme" label is replaced by an accessible name on the select.
- The existing colour tokens are reused. The dot colours come from the live and error colours the page already defines. No dependency is added.
- The header stays sticky, with the same blurred background.

## Testing Decisions

- A good test checks what the user sees in the real page: the text and tooltip of the pill, the colour of the dot in each state, and that the controls stay inside the header.
- The seam is the real page in headless Chromium through the shared `test/browser.js` helper, as the other Dashboard page tests do. These tests skip when Chromium is not installed.
- Cases: a long project path shows its folder name with the full path as tooltip; a Windows-style path shows its last segment; the status dot differs between live and error; the theme select has an accessible name; at a narrow width the header does not overflow sideways.
- Prior art: `test/dashboard-page.test.js` and `test/dashboard-scroll-browser.test.js`.

## Out of Scope

- New header information such as a count of Runs waiting on you
- Changes to the board, cards, detail panel or dialogs
- A new theme or colour scheme

## Further Notes

The browser tab title already shows the number of Runs waiting on you.
