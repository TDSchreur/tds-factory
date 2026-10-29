## Problem Statement

With Dashboards for several repositories open, every browser tab reads "tds-factory dashboard", so the right tab is hard to find. The tab also has no icon.

## Solution

The tab title leads with the repository name and drops the word "dashboard": `<repo> · TDS Factory`, with the usual `(N) ` prefix while Runs wait on the user. Until the project name is known, and in the fallback page, the title is `TDS Factory`. The Dashboard serves an SVG favicon drawn from the TDS mark.

## User Stories

1. As a Factory user with several Dashboards open, I want the repository name first in the tab title, so that I find the right tab.
2. As a Factory user, I want the title to say "TDS Factory" with proper casing and no word "dashboard", so that it reads as a brand.
3. As a Factory user, I want the `(N)` waiting count to stay in front of the title, so that I still see when a Run needs me.
4. As a Factory user, I want a recognisable icon in the tab, so that Factory tabs stand out among others.

## Implementation Decisions

- The page title is set from the `project` folder name that `/api/info` already returns (the same name the header pill shows). The static `<title>` and the fallback page say `TDS Factory`.
- The favicon is `dashboard/favicon.svg`, served at `/favicon.svg` through the fixed asset list, linked from `index.html`. It shows the factory part of the logo in white on the logo's blue gradient and reads in light and dark browser themes.

## Testing Decisions

- Browser tests check `document.title` with and without waiting Runs, and that the page links the favicon. The asset test checks `/favicon.svg` is served as `image/svg+xml`. Existing title assertions are updated.

## Out of Scope

- A PNG or `.ico` fallback; changing the header or the logo.
