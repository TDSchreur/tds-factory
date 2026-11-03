# Run detail as a modal right drawer, and a Dashboard without horizontal scrolling

## Problem Statement

Selecting a card opens the Run detail beside the board and pushes the other columns away, so the board jumps and shrinks. The Dashboard also needs a horizontal scrollbar: the six Stage columns overflow between 1025 and about 1300 CSS pixels, and the "Token usage per Stage, model and Ticket" table in the Run detail does not fit its panel because every cell refuses to wrap. The detail's open-state layout is held together by hand-written focus trapping and scroll-position measuring, and one browser test of that measuring is flaky.

## Solution

The Run detail becomes a modal drawer on the right (ADR 0031, which supersedes ADR 0004 and the detail part of ADR 0008). The board keeps its full width and stays visible behind a light backdrop. Through 1024 CSS pixels the detail stays a full-screen sheet with the Back control. Every part of the Dashboard fits the viewport without a horizontal scrollbar, except the Markdown tables inside summaries, which keep their own scroll area so that wide tables stay readable (WCAG 2.2 1.4.10 exception).

## User Stories

1. As a Dashboard user, I want the Run detail to open over the board, so that the columns do not move when I select a card.
2. As a Dashboard user, I want the board to stay at full width behind the detail, so that I still see which Runs are waiting.
3. As a Dashboard user, I want a light backdrop behind the drawer, so that I can tell the board is not available while I read.
4. As a Dashboard user, I want clicking the backdrop to close the detail, so that dismissing it is quick.
5. As a keyboard user, I want Escape to close the detail, so that I can leave without a mouse.
6. As a keyboard user, I want Tab to stay inside the open detail, so that I never land on hidden board controls.
7. As a keyboard user, I want focus to return to the Run's card when the detail closes, so that I keep my place.
8. As a screen reader user, I want the drawer announced as a labelled dialog with the Run title as its first focus, so that I know where I am.
9. As a screen reader user, I want the board behind the drawer to be unavailable, so that I do not read it by accident.
10. As a Dashboard user, I want the Grant extra loop confirmation to appear above the drawer, and Escape to close only that confirmation first, so that nested dialogs behave.
11. As a Dashboard user, I want the open detail to survive the Dashboard's refresh without flicker, scroll reset or reopening, so that reading is not interrupted.
12. As a Dashboard user, I want the drawer to close when its Run disappears, so that I am not left with a stale drawer.
13. As a phone or tablet user, I want the detail to stay a full-screen sheet with a Back control through 1024 CSS pixels, so that summaries stay readable.
14. As a Dashboard user on a small laptop (1025 to 1300 pixels), I want all six Stage columns to fit without a horizontal scrollbar, so that I see the whole board.
15. As a Dashboard user, I want the token usage table to fit the drawer, so that I can read every column without sideways scrolling.
16. As a Dashboard user on a narrow drawer, I want each usage row to stack its figures under the row label, so that the numbers stay readable.
17. As a screen reader user, I want the usage table to keep its table semantics (caption, headers, row headers, cells) in both layouts, so that figures stay linked to their labels.
18. As a Dashboard user, I want long Run titles, labels and links to wrap, so that they never push the page wider.
19. As a Dashboard user, I want wide Markdown tables in a summary to scroll in their own focusable area, so that they stay readable.
20. As a low-vision user, I want the page to fit at 320 CSS pixels, so that reflow works with zoom (WCAG 1.4.10).
21. As a user with reduced-motion settings, I want no slide animation on the drawer, so that nothing moves unexpectedly.
22. As a maintainer, I want a guard test that fails when any width from 320 to 1440 gets a horizontal scrollbar with the detail open, so that the problem cannot come back.
23. As a maintainer, I want the drawer's browser tests to be deterministic, so that CI does not fail on measured scroll positions.
24. As a maintainer, I want ADR 0004 and ADR 0008 marked superseded and the Run detail glossary entry updated, so that the documents agree with the Dashboard.

## Implementation Decisions

- The Run detail is a native modal dialog opened imperatively when a Run is selected; a Dashboard refresh must not reopen or reset it. Its closing paths (Escape, backdrop click, the close button, Back, the Run disappearing) all end in the same close operation, which returns focus to the card.
- The hand-written background inerting, Tab trap, body scroll lock and sticky-position measuring are removed; the native dialog provides them. The global Escape handler no longer closes the detail itself and must not close it while another dialog is on top.
- The board has no column for the detail and no open-state layout; it keeps its full width. The sheet is about min(56rem, 100vw - 4rem) wide and full height, with a light backdrop.
- At and below the compact breakpoint (1024 CSS pixels) the same dialog is full-screen with the Back control and no close button, as in ADR 0008.
- No slide animation; honour the existing reduced-motion rule. No URL or hash state for the open Run.
- Board columns use a smaller minimum width (9rem) so six columns fit at 1025 pixels. The compact breakpoint does not move.
- Token usage table: figures stay on one line, headers never break inside a word and row labels break at the " · " separators first, the table fills the drawer width. When the drawer's own width (container query, below 35rem) is narrow, each row stacks, with the row label first and each figure labelled by its column header, while the roles of table, caption, header, row header and cell stay in the accessibility tree. The inner horizontal scroll wrapper is removed.
- Long text (titles, labels, links) wraps anywhere in the drawer and on cards.
- Markdown tables keep their focusable scroll area and are the only allowed horizontal overflow.
- ADR 0031 records the decision; ADR 0004 is marked superseded and ADR 0008 partly superseded; the glossary entry for Run detail drops the "Avoid: Modal" and describes the drawer over the board.
- Documents to update (from the Sweep): `docs/dashboard.md`, `GLOSSARY.md`, ADR 0004, 0008 and 0031, and the current specs `docs/specs/dashboard-responsive-usability.md` and `docs/specs/dashboard-help.md` (the "drawer starts below the header" and "adjacent detail" wording). Archived specs stay unchanged. The Dashboard help text in `dashboard/` is checked for the same wording.

## Testing Decisions

- A good test drives the Dashboard in a real browser and checks what the user sees or can do (a card is clickable, the board width does not change, focus lands where expected, the page does not scroll sideways), not the implementation.
- Single seam: the existing Dashboard browser tests with the stub server and browser helper. The pinned layout assertions in the page, detail-responsive, scroll and usage browser tests change to the drawer behaviour.
- New: a guard test at widths 320, 375, 768, 1024, 1025, 1280 and 1440 with the detail open and fixtures with long titles and long usage rows. It asserts that the page's scroll width does not exceed its client width and that no element with horizontal auto or scroll overflow actually overflows, except inside Markdown tables.
- New: usage table tests that assert the table, caption, column header, row header and cell roles in the wide and the stacked layout.
- Flaky detail-responsive scroll test (scroll position 1262 against 1296): replaced by a deterministic check that does not depend on measured sticky offsets.
- Prior art: the existing responsive and scroll browser tests, which set an actual CSS viewport.

## Out of Scope

- URL or hash state for the open Run, and selecting another card while the drawer is open (close first).
- Changes to the compact Stage navigation, the card contents and the Markdown renderer.
- Resizable or dockable drawers.

## Further Notes

Accepted trade-off (ADR 0031): while the drawer is open the board is not interactive, so another card needs the drawer to be closed first. Follow-up PR feedback is kept separate from this Spec.
