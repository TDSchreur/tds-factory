# Run detail drawer

## Problem Statement

When I click a Run's card on the Dashboard, its detail (links and stage summaries) appears after the board, below the last card. On a board with many cards it is often off-screen, so I click and nothing seems to happen. I have to scroll down to read it, and scroll back up to pick the next Run.

## Solution

The Run detail opens as a drawer on the right of the board, next to the cards instead of below them. The board narrows to make room and stays clickable. Clicking another card switches the drawer to that Run; clicking the same card, pressing Esc or pressing the close button closes it. The drawer has a fixed header with the Run's title, stage, status and chips, and a body that scrolls on its own. On small screens the drawer is a full-screen sheet.

## User Stories

1. As a Dashboard user, I want the Run detail to open next to the board, so that I can see it without scrolling the page
2. As a Dashboard user, I want the board to stay visible while the Run detail is open, so that I can still see which Runs are waiting on me
3. As a Dashboard user, I want to click another card while the Run detail is open and have it switch to that Run, so that I can compare Runs quickly
4. As a Dashboard user, I want a second click on the selected card to close the Run detail, so that the behavior I know keeps working
5. As a Dashboard user, I want a close button in the Run detail, so that I can dismiss it without hunting for the card
6. As a keyboard user, I want Esc to close the Run detail, so that I can dismiss it without the mouse
7. As a keyboard user, I want focus to move to the Run detail's heading when it opens, so that I can read it and tab through its links
8. As a keyboard user, I want focus to return to the card when the Run detail closes, so that I do not lose my place on the board
9. As a Dashboard user, I want the Run detail header to show the title, stage, status, Needs you reason, chips, agent and update time, so that I see the Run's state without scrolling the body
10. As a Dashboard user, I want the header to stay in view while I scroll the summaries, so that I always know which Run I am reading
11. As a Dashboard user, I want the summaries to scroll inside the drawer, so that reading a long one does not move the board
12. As a Dashboard user, I want the drawer's scroll position to survive the Dashboard's poll, so that I am not thrown back to the top while reading
13. As a Dashboard user, I want the old text to stay until refreshed files have loaded, so that the drawer does not flicker or shrink on refresh
14. As a Dashboard user, I want the Spec, Ticket and pull request links in the drawer, so that I can jump to them
15. As a Dashboard user, I want a Run without summaries to say "No summaries yet", so that an empty drawer is not mistaken for a bug
16. As a Dashboard user on a phone or narrow window, I want the Run detail to take the full screen with a close button, so that it is readable
17. As a Dashboard user on a narrow window, I want the board to be usable again after I close the sheet, so that I can pick another Run
18. As a Dashboard user, I want the selected card to stay highlighted while its Run detail is open, so that I know which card it belongs to
19. As a Dashboard user, I want the drawer to close when its Run disappears (for example it is deleted or becomes hidden), so that I am not left with a stale panel
20. As a Dashboard user, I want the drawer to follow the light and dark theme, so that it matches the rest of the page
21. As a Dashboard user, I want Merge and Delete to stay where they are on Done cards, so that this change does not alter how I act on Runs
22. As a screen reader user, I want the drawer to be a labelled region, so that I can find and leave it

## Implementation Decisions

- The Run detail changes from a block after the board to a side panel in a two-pane page layout: the board on the left, the Run detail on the right when a Run is selected, and the board alone when none is.
- The panel is non-modal: no backdrop, no focus trap, and the board remains interactive. Selecting another card switches the shown Run; selecting the selected card clears the selection, as today.
- On wide screens the panel pushes the board (the board narrows and keeps its own horizontal scroll). It is roughly 40rem wide and scrolls independently of the page, with a header that stays at the top of the panel.
- Under the existing 48rem breakpoint the panel becomes a full-screen sheet over the board with a visible close button.
- The panel header shows the title, the stage, the status (including abandoned), the Needs you reason when waiting, the chips, the agent, the update time and a close button; the links follow, then the summaries.
- Esc closes the panel. Opening moves focus to the panel heading; closing returns focus to the card that opened it.
- The panel keeps the existing refresh behavior: it reloads the Run's files only when the Run's identity, title, update time, files or links change, and keeps the old text visible until the new text has arrived.
- The panel closes when the selected Run is no longer in the list shown.
- Card actions (Merge, Delete, Show details) are unchanged.
- The Run detail is added to the glossary, and ADR 0004 records the choice of a non-modal, push-layout drawer over a modal or overlay.
- The vendored Preact and htm approach (ADR 0003) is kept; no new dependencies.

## Testing Decisions

- A good test drives the real page and checks what the user sees and can do: where the panel is, whether the board is still visible, what Esc and the close button do, where focus is. It does not check component internals or class names beyond the stable ids and labels the page already exposes.
- The one seam is the browser-driven page seam the repo already uses (`openPage` with a fake server in the Dashboard page tests). No new seam is introduced.
- Tests to add or change there: the panel opens beside the board and not below it (the panel and the last card overlap vertically on the page), the board stays clickable and switching cards switches the Run, close by button, Esc and second click, focus in and back, the header content, the full-screen sheet at a narrow viewport, and the panel closing when its Run goes away.
- Existing Run detail tests (Markdown rendering, links, "No summaries yet", hidden when nothing is selected) must keep passing, changed only where the markup moved.
- The scroll test changes from page scroll to the panel's own scroll: after polls refresh the open Run, the panel's scroll position is unchanged.
- Prior art: the Dashboard page tests, the scroll browser test and the header browser test.

## Out of Scope

- Moving Merge, Delete or other card actions into the panel.
- Changing the card design, the columns or the header.
- Resizing or dragging the panel, remembering its width, or remembering which Run was open across reloads.
- Linking to a Run by URL.
- Any change to the Run store, the server API or the Markdown renderer.

## Further Notes

- The user said "ticket" but meant the Run's card; the glossary now calls the panel the Run detail and lists Ticket as a term to avoid for it.
