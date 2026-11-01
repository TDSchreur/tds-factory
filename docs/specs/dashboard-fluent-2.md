# Dashboard: Fluent 2 tokens

## Problem Statement

The Dashboard still has the look of its first version: a small set of hand-picked colours and sizes. The v0.6.0 goal is a new design, and [ADR 0025](../adr/0025-the-dashboard-adopts-fluent-2-through-design-tokens.md) decided how: Fluent 2 design tokens in the Dashboard's own CSS, with hand-built components. This is the sixth item of the Dashboard work in milestone v0.6.0.

## Solution

Replace the colour and size variables of `dashboard/style.css` with a token layer taken from the Fluent 2 web themes, then move every rule onto those tokens, so the cards, buttons, chips, badges, progress bar, drawer, dialog, header and Stage navigation share one visual language in light, dark and high contrast. No behaviour change, no new markup beyond what the restyle needs.

## User Stories

1. As a user, I want the Dashboard to look like a Fluent 2 app (neutral surfaces, brand blue accent, 14 px type, 4 px corners, soft elevation), so that it feels current and consistent.
2. As a user, I want the light and dark themes and "System" to keep working as they do today, so that my choice still applies.
3. As a user, I want every text and its background to keep at least 4.5:1 contrast in both themes, so that I can read everything.
4. As a user, I want pass, fail, quiet and waiting states to keep their text and symbols and to use Fluent's status colours, so that nothing relies on colour alone.
5. As a keyboard user, I want a clearly visible focus ring on every control in both themes, so that I can see where I am.
6. As a user who prefers reduced motion, I want transitions switched off, so that nothing moves.
7. As a user of high contrast (forced colours), I want borders, focus, the progress bar and the state markers drawn in system colours, so that the Dashboard stays usable.
8. As a user on a phone, I want the Stage navigation, the cards and the full-screen detail to keep working at narrow widths with 44 px targets.
9. As a maintainer, I want the stylesheet to use only the token layer, with the tokens named as Fluent names them and their source recorded, so that the next token update is a data change.

## Implementation Decisions

- The token layer is a block at the top of `dashboard/style.css` with the Fluent token names (`--colorNeutralBackground1`, `--fontSizeBase300`, `--borderRadiusMedium`, `--shadow4`, ...), once for light on `:root`, once for dark under `:root[data-theme="dark"]` and under the `prefers-color-scheme` media query (the same three places as today). Only tokens the stylesheet uses are included. A comment names the source (`@fluentui/tokens` 1.0.0-alpha.24, `webLightTheme` and `webDarkTheme`), as ADR 0025 says. THIRD-PARTY-NOTICES already carries the notice.
- The accent is Fluent's brand blue. The state colours are `colorPaletteGreenForeground1`, `colorPaletteRedForeground1` and `colorStatusWarningForeground1` (with the matching Background1 tokens for tinted areas). The TDS logo keeps its two blues; its dark ink follows `colorNeutralForeground1`.
- Body type is `fontSizeBase300` (14 px) with the Fluent font list unchanged (Segoe UI first, then the system fonts, no font is shipped). Spacing, radius, stroke and shadow use the Fluent tokens; layout breakpoints and the 44 px touch targets stay.
- A token pair that misses 4.5:1 is replaced by the next stronger Fluent token, and the replacement is noted in the stylesheet.
- Focus: `:focus-visible` draws a two-ring outline from `colorStrokeFocus1` and `colorStrokeFocus2`. `@media (prefers-reduced-motion: reduce)` removes transitions and animations. `@media (forced-colors: active)` sets borders, focus, the progress bar fill, chips and badges to system colours.
- The old variable names (`--bg`, `--card`, `--primary`, `--flag`, ...) are gone; no rule uses a literal colour or a `rem` or `px` size that a token covers, except layout breakpoints and the 44 px targets.
- Markup changes only where the restyle needs a hook.
- `docs/dashboard.md` and a changelog fragment are updated; screenshots are D7.

## Testing Decisions

- Unit tests (`test/dashboard-design.test.js` and a new `test/dashboard-tokens.test.js`): the token layer is defined for light and dark; every `var(--...)` the stylesheet uses is defined; no literal colour remains outside the token layer and the logo; the WCAG contrast of the text and background pairs the stylesheet uses is at least 4.5:1 in both themes (computed from the token values); reduced motion and forced colours blocks exist.
- Browser tests: the existing `dashboard-*-browser.test.js` files keep passing, with their colour expectations updated; a new test computes the rendered text and background colours of the main elements in light and dark and checks 4.5:1; a focus-ring test, a reduced-motion test and a forced-colours test (Chromium can emulate `forced-colors` and `prefers-reduced-motion` through the DevTools protocol).

## Out of Scope

New components, layout changes, the help panel and empty state (D7), screenshots in the docs, vendoring any Fluent library.
