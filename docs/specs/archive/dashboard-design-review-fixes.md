# Dashboard design review fixes

## Problem Statement

A visual review of the Dashboard at 375, 768, 1280 and 1920 px found no overflow, but three small design problems. On a phone, the ticket links and the "Show details" buttons are too small to tap reliably. In the narrow Check column, a long Chip such as "Infrastructure skipped" wraps onto two lines inside its pill. On a wide screen, the Done column grows far below the other columns, so the page becomes very long.

## Solution

Make the tap targets on small screens at least 44 px high, keep each Chip on a single line, and give the Done column its own scroll on wide screens so it never makes the page much taller than the viewport.

## User Stories

1. As a developer on a phone, I want the ticket links on a Run card to be easy to tap, so that I do not open the wrong issue
2. As a developer on a phone, I want the "Show details" button to be easy to tap, so that I can expand a Done Run without zooming
3. As a developer on a phone, I want the Delete and Merge buttons on a Done card to be easy to tap, so that I do not hit the wrong one
4. As a developer on a desktop with a mouse, I want the cards to keep their compact layout, so that the larger tap targets do not waste space
5. As a developer, I want each Chip ("Standards pass", "Infrastructure skipped") to stay on one line, so that the pills look clean
6. As a developer, I want a row of Chips to wrap between Chips and never inside one, so that a narrow column stays readable
7. As a developer on a wide screen, I want the Done column to scroll on its own when it is long, so that the page does not become a long scroll
8. As a developer on a wide screen, I want the other columns to stay visible without scrolling far, so that I see what is running at a glance
9. As a developer on a phone, I want the board to keep stacking into one column with the full list, so that I can read every Run
10. As a developer using a keyboard, I want focus to stay visible inside the scrolling Done column, so that I can reach every card
11. As a developer using dark or light theme, I want these fixes to look right in both, so that the theme choice does not matter

## Implementation Decisions

- Changes are limited to the Dashboard stylesheet; no markup or data changes.
- On the narrow-screen layout (the existing mobile breakpoint), ticket links, the Show details toggle, and the Delete and Merge buttons get a minimum height of 44 px, laid out as inline flex so text stays vertically centred. The compact desktop sizes stay unchanged.
- A Chip never wraps its own text. The Chip row keeps wrapping between Chips. A Chip wider than its column is truncated with an ellipsis rather than overflowing.
- On the desktop layout (wider than the mobile breakpoint), the list of cards in the Done column has a maximum height tied to the viewport height and scrolls vertically. The other columns are not capped. The Done column header and "Delete all" button stay outside the scroller so they remain visible.
- On the mobile layout the Done column is not capped; it stays a plain full-height list.
- The 404 seen once on first load was not reproducible and is out of scope.

## Testing Decisions

- A good test opens the real Dashboard page in headless Chromium and checks what a user sees: rendered sizes, line counts and scroll behaviour, not CSS text.
- One seam: the existing browser test helper that opens the Dashboard against a stub server.
- Cases: at a phone width, the ticket links, the Show details toggle and the Delete button are at least 44 px high; every Chip renders on a single line even in a narrow column; at a desktop width with many Done Runs, the Done card list scrolls inside its column and the page height stays near the viewport height; at a phone width, the Done column shows all cards without its own scroll.
- Prior art: `test/dashboard-scroll-browser.test.js` and `test/dashboard-header-browser.test.js`. Tests skip when Chromium and ChromeDriver are missing.
- Run `npm test`.

## Out of Scope

- The unreproduced 404.
- Redesigning the board layout or adding new columns.
- Dark-mode contrast review (not checked in the visual review).
- Changing desktop control sizes.

## Further Notes

Source: web design review of the Dashboard done with the web-design-reviewer skill. All findings were priority P3.
