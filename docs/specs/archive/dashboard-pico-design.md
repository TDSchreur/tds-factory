# Dashboard Pico-inspired design

## Problem Statement

The Dashboard works but looks plain: dense type, flat grey panels, default buttons and no layout for narrow screens.

## Solution

Restyle the Dashboard in the spirit of Pico CSS: a clean semantic look, a tokenised palette, a consistent type and spacing scale, polished buttons, form controls, chips and cards, visible focus states, and a layout that adapts to narrow screens. Pico itself is not added; the CSS stays hand-written inside `dashboard.html`.

## User Stories

1. As a developer, I want a clearer type scale and spacing, so that Runs are easy to scan.
2. As a developer, I want a sticky header holding the title, project, status, theme selector and older-runs toggle, so that controls stay in reach.
3. As a developer, I want Runs waiting on me to stand out clearly in both themes, so that I notice them.
4. As a developer, I want Check verdict chips that read as pass, fail or neutral, so that I see the state at a glance.
5. As a developer, I want buttons, the select and focus rings styled consistently, so that the page feels coherent and is keyboard friendly.
6. As a developer, I want the board to scroll or stack on narrow screens, so that it stays usable on a small window.
7. As a developer, I want the Run detail shown in a readable panel, so that summaries are easy to read.

## Implementation Decisions

- Only `dashboard.html` changes, mainly its CSS. Keep the existing ids, class names and data attributes that scripts and tests use, so behaviour and the Light/Dark/System theme logic stay intact.
- Define design tokens (colours, radius, spacing, shadow) per theme with the existing three-way theme mechanism.
- Add a sticky header; below about 48rem the board columns stack into one column; the detail panel keeps its place below the board.
- No new dependency, no network resource, no server change.

## Testing Decisions

Test through the existing Dashboard page seam: the page keeps its required elements and classes, declares tokens for light and dark, has a sticky header and a narrow-screen rule, and defines focus styles. The existing theme and control tests keep passing. Run `npm test`. Check both themes visually when a browser is available.

## Out of Scope

Adding Pico CSS as a dependency, new palettes, and any change to the server API or Run record.
