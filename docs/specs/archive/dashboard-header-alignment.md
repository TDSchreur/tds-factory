# Dashboard header alignment

## Problem Statement

In the Dashboard top bar the tagline sits on the bottom edge of the logo while the project pill and the status are centred, so the items do not line up. The tagline also says "dashboard", and I want it to say "Factory".

## Solution

The logo and the tagline are centred on the same line as the rest of the top bar. The tagline reads "Factory".

## User Stories

1. As a developer, I want the tagline vertically centred next to the logo, so that the top bar looks aligned
2. As a developer, I want the tagline to read "Factory", so that the top bar names the tool

## Implementation Decisions

- The title block aligns its items to the centre instead of the text baseline.
- Only the visible tagline changes; the page title and the heading text for screen readers stay as they are.

## Testing Decisions

- Extend `test/dashboard-logo-browser.test.js`: the tagline text is "Factory" and its vertical centre is within a few pixels of the logo's vertical centre.
- Run `npm test`.

## Out of Scope

- The page `<title>`.
- Other top bar styling.
