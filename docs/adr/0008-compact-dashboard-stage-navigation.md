# Compact Dashboard shows one Stage and full-screen Run detail

> Partly superseded: above 1024 CSS pixels the Run detail is no longer an adjacent non-modal drawer; see [ADR 0031](0031-run-detail-as-a-modal-right-drawer.md). Compact Stage navigation and the full-screen detail through 1024 pixels stand.

Through 1024 CSS pixels, the Dashboard shows one selected Stage with counts and waiting markers on navigation to every Stage, and Run detail occupies the screen with Back navigation. Stacking all Stages with jump links kept pages long, while preserving desktop columns and the push drawer at small laptop widths squeezed cards and required sideways scrolling; the user chose focused navigation in exchange for simultaneous visibility. Above 1024 CSS pixels the multi-column board and adjacent, non-modal Run detail from ADR 0004 remain; compact detail contains focus and background scrolling and returns to the Run's card in its current Stage.
