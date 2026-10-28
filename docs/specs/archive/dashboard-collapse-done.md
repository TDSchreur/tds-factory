# Collapse Done cards on the Dashboard

## Problem Statement

The Done column grows by one full card for every finished Run. After a few Runs it is much taller than the other columns and pushes the page down.

## Solution

Done cards start collapsed to a title, the last update time and an expand toggle. Expanding a card shows the rest of it. The other columns do not change.

## User Stories

1. As a developer, I want Done cards to start collapsed, so that the Done column stays short.
2. As a developer, I want a collapsed Done card to show its title, so that I can still find a Run.
3. As a developer, I want a collapsed Done card to show when it was last updated, so that I can tell how old it is.
4. As a developer, I want an expand toggle on each Done card, so that I can see its details when I need them.
5. As a developer, I want an expanded Done card to show its chips, agent, PR link and Delete button, so that nothing is lost.
6. As a developer, I want clicking a Done card to still open its summaries below the board, so that the toggle does not replace that.
7. As a developer, I want the toggle to be a separate control from the card click, so that expanding does not open the summaries.
8. As a developer, I want the toggle reachable and operable from the keyboard, so that I do not need a mouse.
9. As a screen reader user, I want the toggle to say whether the card is expanded, so that I know its state.
10. As a developer, I want an expanded card to stay expanded when the board refreshes, so that polling does not collapse it.
11. As a developer, I want expanded cards to stay expanded until I reload the page, like "Show older".
12. As a developer, I want abandoned Runs marked as abandoned even when collapsed, so that I can tell them from finished ones.
13. As a developer, I want the other columns unchanged, so that active Runs show all their information.
14. As a developer, I want "Delete all" and the 7-day "Show older" button to behave as before.

## Implementation Decisions

- Only cards in the Done column collapse. Cards in other columns render as before.
- A collapsed Done card shows the title, the Updated line, the Abandoned marker when it applies, and a toggle.
- An expanded Done card shows everything it shows today.
- The toggle is a button inside the card. Its click does not select the card, and its keys do not reach the card's key handling.
- The toggle carries `aria-expanded` and an accessible name that includes the Run title.
- Expanded state is kept per Run id in page memory, so it survives each board rebuild and resets on reload. There is no Expand all control.
- The Dashboard server, API and Run store do not change.
- The canonical Dashboard Spec's Done column rule is updated to mention collapsed cards.

## Testing Decisions

- A good test checks what a user can see and do, not how the page is built.
- Test through the page's own script, as the existing Dashboard control and theme tests do.
- Cover: Done cards start collapsed and other columns do not; the toggle expands and collapses; the toggle does not select the card; expanded state survives a re-render; the Abandoned marker shows when collapsed.
- Prior art: the dashboard controls and theme tests, which run the page script in a VM context.

## Out of Scope

- Capping the number of Done Runs shown, scrolling inside the column, or changing the 7-day rule.
- An Expand all control or remembering the state across reloads.
- Changes to other columns, the server or the Run store.

## Further Notes

Replaces an earlier idea of showing only the 5 newest Done Runs, which was dropped in favour of collapsing.
