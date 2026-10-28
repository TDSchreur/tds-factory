# Dashboard logo

## Problem Statement

The Dashboard top bar shows the plain text "tds-factory". The Factory has a logo (a factory with a code tag, blue "D" and the letters TDS), and I want it in the top bar.

## Solution

The top bar shows the logo as an SVG in place of the "tds-factory" heading text. The SVG is drawn inline in the page, so it needs no new file served and works offline. The dark parts of the logo follow the theme, so they stay visible in dark mode. The heading keeps its text for screen readers.

## User Stories

1. As a developer, I want the Factory logo in the top bar, so that I recognise the tool at a glance
2. As a developer using the dark theme, I want the dark parts of the logo to turn light, so that the logo stays readable
3. As a developer using the light theme, I want the logo in its original colours, so that it matches the brand
4. As a developer using a screen reader, I want the heading to still read "tds-factory", so that the page keeps its title
5. As a developer on a phone, I want the logo to fit the top bar without wrapping the header, so that the bar stays compact
6. As a developer, I want the logo to scale without blur on any screen, so that it looks sharp on high-density displays
7. As a developer on a machine without internet, I want the logo to load, so that the Dashboard needs no external resource

## Implementation Decisions

- The logo is an inline SVG inside the page's header heading, marked decorative for assistive technology. The heading text stays in the page as visually hidden text.
- Only the "TDS" mark is drawn; the small "FACTORY" caption is left out because it is unreadable at top bar height. The tagline "dashboard" stays next to the logo.
- The dark parts use a theme colour that is near black in the light theme and light grey in the dark theme. The blue parts keep their colour in both themes.
- The logo is about 2.25 rem high and keeps its aspect ratio.
- No new route is served and the allowed asset list does not change.
- The SVG is a hand-traced approximation of the supplied PNG, not an export of the original artwork.

## Testing Decisions

- A good test opens the real Dashboard page in headless Chromium and checks what a user sees.
- One seam: the browser test helper that opens the Dashboard against a stub server.
- Cases: the top bar contains a visible logo SVG of a sensible size; the heading text is still "tds-factory"; the dark parts of the logo have a different colour in the dark theme than in the light theme; the logo does not make the header overflow at phone width.
- Prior art: `test/dashboard-header-browser.test.js` and `test/dashboard-theme.test.js`.
- Run `npm test`.

## Out of Scope

- A favicon.
- The "FACTORY" caption and an exact copy of the original artwork.
- Changing the page title.
