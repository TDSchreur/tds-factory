# Run detail as a non-modal side drawer that pushes the board

The Run detail used to render in a section after the board, so selecting a card often showed it below the last card, off-screen. We now open it as a drawer on the right of the board, beside it rather than over it. The board shrinks to make room, stays clickable, and clicking another card swaps the drawer to that Run. We rejected a centered modal because the Dashboard is a monitor: a modal hides the board, so waiting Runs and stage changes go unseen while you read. We rejected an overlay drawer because the board already scrolls sideways and an overlay would hide the Done and Finish columns. On screens under 48rem the drawer becomes a full-screen sheet. The cost is that the board loses width while a Run is open.

ADR 0008 refines this decision: the full-screen detail breakpoint extends through 1024 CSS pixels alongside compact Stage navigation, while larger screens retain the adjacent non-modal drawer.
