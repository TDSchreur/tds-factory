# Dashboard themes

## Problem Statement

The Dashboard follows the system color scheme but offers no way to choose a different appearance.

## Solution

A theme selector offers Light, Dark and System. System is the default and follows the operating system. The selection is remembered in the current browser across reloads.

## User Stories

1. As a developer, I want to choose Light, so that the Dashboard stays light regardless of my system setting.
2. As a developer, I want to choose Dark, so that the Dashboard stays dark regardless of my system setting.
3. As a developer, I want System to follow changes in my system setting, so that the Dashboard adapts automatically.
4. As a developer, I want my choice restored after reload, so that I do not have to select it again.
5. As a developer, I want the selector labeled and keyboard accessible, so that I can use it with assistive technology.
6. As a developer, I want the Dashboard to remain usable if browser storage is unavailable, so that I can still read and choose a theme for this page.

## Implementation Decisions

- Keep the existing light and dark palettes and extend the Dashboard page with a labeled selector. System is the initial choice absent a valid saved preference.
- Apply a valid saved preference before painting when possible. Explicit choices override the system; System responds to system changes. Native controls use the selected color scheme.
- Store the choice locally in the browser. Handle unavailable storage and invalid saved values gracefully without disrupting the Dashboard.
- The change introduces no server API or new dependency. Keep existing Dashboard functionality intact.

## Testing Decisions

Test user-visible selection, persistence, invalid and unavailable storage, system behavior and explicit overrides through the existing Dashboard page test seam. Run the project's verify command. Check both themes visually when a browser is available.

## Out of Scope

Additional palettes, per-project synchronization and theme scheduling.
