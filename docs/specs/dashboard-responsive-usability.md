## Problem Statement

The Dashboard is difficult to use on phones, tablets and small laptops. Stacked Stage columns require long scrolling to reach later Stages, while the desktop board scrolls sideways and squeezes Run cards at 1024 CSS pixels. Opening Run detail further reduces the available width. Header controls, dialog actions and the detail close control have small touch targets, and long summary text can overflow the detail panel. Existing browser tests request a narrow window without ensuring that Chromium actually uses the requested CSS viewport.

## Solution

Provide a compact Dashboard through 1024 CSS pixels with one selected Stage and visible navigation to every Stage. Show Stage counts and waiting indicators so users can find Runs needing attention. Open Run detail as a full-screen view at these widths, with a clear Back control that restores the selected Stage and card. Preserve the desktop board and adjacent detail panel above this breakpoint, using the existing styling, themes and browser tooling.

## User Stories

1. As a phone user, I want the Dashboard to fit 320, 375 and 390 CSS pixels, so that I can read and operate it without sideways page scrolling.
2. As a tablet user, I want readable Run cards at 768 CSS pixels, so that unused width and long Stage stacks do not obstruct my work.
3. As a small laptop user, I want readable cards at 1024 CSS pixels, so that narrow desktop columns do not hide important information.
4. As a user, I want to move directly between Define, Build, Check, Finish and Done, so that reaching later Stages does not require scrolling through earlier Runs.
5. As a user, I want each Stage control to show its Run count and whether a Run needs me, so that compact navigation does not hide waiting work.
6. As a user, I want my chosen Stage to remain selected during polling, so that refreshes do not interrupt my reading.
7. As a user, I want to browse an empty Stage, so that I can distinguish no Runs from a missing Stage.
8. As a user, I want Run detail to use the available compact screen, so that summaries remain readable.
9. As a user, I want Back and Escape to return to the selected card and Stage, so that reading detail preserves my place.
10. As a keyboard user, I want focus to remain inside a full-screen detail view, so that I do not operate hidden controls.
11. As a touch user, I want the background to remain stationary while I read detail, so that returning preserves my position.
12. As a user, I want long titles, paths, links and summary text to remain readable, so that content does not create unintended horizontal scrolling.
13. As a user, I want dialogs to keep actions reachable on narrow or short screens, so that I can safely confirm or cancel operations.
14. As a touch user, I want controls at least 44 CSS pixels high with appropriately sized close and navigation targets, so that actions are easy to select.
15. As a user, I want the Factory version, project identity, connection status and theme control to remain available, so that responsive layout preserves existing information and preferences.
16. As a desktop user, I want to keep the multi-column Dashboard and adjacent Run detail, so that I can monitor other Runs while reading.
17. As a maintainer, I want responsive tests to assert the actual CSS viewport, so that a browser window minimum cannot mask layout regressions.

## Implementation Decisions

- Navigation covers exactly the five Dashboard columns: Define, Build, Check, Finish and Done. The desktop board uses these five columns without an unused sixth track.
- The compact breakpoint is inclusive: at 1024 CSS pixels and below, display one selected Stage; above it, display the existing multi-column board. Stage controls fit or wrap within available width and have accessible names, selection state, counts and waiting markers.
- The initial compact Stage favors work waiting on the user, otherwise the first nonempty Stage in Flow order, otherwise Define. Explicit selection remains stable during polling, including when that Stage becomes empty. Counts reflect visible Runs after the existing older-Run filter; waiting Runs remain visible under that filter.
- Preserve Stage selection when moving between compact and desktop sizes. Filtering and polling continue using existing behavior and do not unexpectedly change the selected Stage.
- Arrange header identity, project, connection status and controls deliberately rather than relying on incidental wrapping. Keep the Factory version beside the logo/Factory identity and ellipsize long project names with the existing full-path tooltip. Connection errors wrap within the screen.
- Compact controls, including navigation, theme, older Runs, card actions, Delete all, introductory disclosure, dialog actions and detail Back, have accessible touch targets. Preserve compact desktop styling where appropriate.
- Run detail becomes a full-screen view through 1024 CSS pixels with a plainly labeled Back control. Keep focus within it and make the covered Dashboard unavailable to keyboard interaction; lock background scrolling while preserving and restoring its position. Closing returns focus to the selected card and retains Stage selection. Escape still closes detail unless a confirmation dialog is active.
- At desktop widths keep the board clickable beside detail. Fit the detail height to the actual available viewport and header so its controls remain visible. Preserve summary scroll position across polling and reset it when selecting another Run.
- Wrap long text and links throughout cards and detail. Wide Markdown tables may scroll inside their existing local wrapper; they must not cause the whole panel or page to scroll sideways.
- Dialog actions wrap or stack when needed and remain reachable through internal scrolling on short viewports. Preserve existing confirmation semantics, safe initial focus, cancellation and destructive-operation safeguards.
- Use browser emulation to set the actual CSS viewport and assert width and height before testing responsive behavior. Reuse the existing ChromeDriver fixture and provide screenshot access without introducing another browser framework.
- No server routes, Run record schemas, themes or destructive-operation behavior change.

## Testing Decisions

- Use the existing real Dashboard browser fixture as the main seam. Assert externally observable layout, navigation, focus, scrolling and request behavior instead of exact CSS declarations or component internals.
- First cover actual emulated viewport dimensions, including widths below Chromium's minimum window width. Responsive assertions must run only after dimension assertions pass.
- Exercise 320, 375, 390, 768 and 1024 CSS pixels, plus a desktop width above the breakpoint. Include long project names, connection errors, long titles, many Runs, waiting Runs, empty Stages, older Runs, links, unbroken summary text and wide Markdown tables.
- Cover Stage switching, counts and waiting markers, stable selection through refresh/filter changes, detail Back/Escape, keyboard containment, restored focus/scroll, detail polling scroll preservation and resizing across the breakpoint.
- Cover minimum touch target sizes, absence of unintended page and panel horizontal scrolling, reachable dialog actions on short viewports, and cancel/confirm behavior.
- Inspect screenshots at representative phone, tablet, small laptop and desktop sizes, including open detail and dialogs. Verify light and dark themes and preservation of the Factory version display.
- Run the project's required Verify command, `npm test`, and review committed changes through all Factory Check axes before opening the pull request.

## Out of Scope

- Replacing the styling system, browser tooling or Preact components with another framework.
- Changing the Flow, Run records, server APIs, merge/delete semantics or theme storage.
- Adding drag-and-drop Stage transitions, swipe navigation or new filtering features.

## Further Notes

The user confirmed one selected Stage and full-screen Run detail through 1024 CSS pixels. The rejected alternative was retaining all compact Stage columns with jump links: it preserves simultaneous visibility but keeps long pages. Baseline inspection at all five requested widths used asserted emulated viewports; representative findings included a 1272px board inside a 1009px viewport content area at 1024, 33px controls, and long summary text overflowing Run detail. The existing side-drawer decision is refined by ADR 0008.
