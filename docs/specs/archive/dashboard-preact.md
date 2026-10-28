# Dashboard on Preact

## Problem Statement

The Dashboard builds its page with hand-written DOM code in one script. Every poll rebuilds the board, so keeping focus, scroll position and open cards needs extra code, and each new feature adds more of it.

## Solution

Rewrite the Dashboard page with Preact and htm, vendored into the repository and loaded as ES modules. There is no build step and no new runtime dependency. The Dashboard looks and behaves the same; only its structure changes, so future features are components.

## User Stories

1. As a maintainer, I want the page built from components, so that a new feature is a new component instead of more DOM code.
2. As a maintainer, I want the framework files committed in the repository, so that the Dashboard needs no `npm install` or bundler.
3. As a user, I want every existing feature to keep working: Stage columns, cards, chips with tooltips, the intro, waiting flags, older-run fold, Done card collapse, Merge, Delete, bulk delete, Run detail with rendered Markdown, theme choice and the title counter.
4. As a user, I want keyboard focus and scroll position kept across refreshes, as before.
5. As a maintainer, I want the tests to drive the real page in a browser, so that they survive further refactors of the page code.

## Implementation Decisions

- Vendor `preact`, `preact/hooks` and `htm` (MIT) as ES modules in `dashboard/vendor/`, with their licenses and a note of the versions. They live in the Dashboard folder, not the top-level `vendor/` folder, which holds the skill submodules that `sync` reads, and `dashboard/` is already in the published `files`.
- `index.html` declares an import map for `preact`, `preact/hooks` and `htm`, and loads `app.js` as a module. A small inline script stays only to set the saved theme before first paint.
- Split the page code into ES modules: `model.js` (Stage and chip descriptions, pure helpers), `markdown.js` (the existing parser, exported), `components.js` (components) and `app.js` (state, polling, mount).
- The server serves a fixed allow-list of file names, now including the modules and vendored files. A request still never chooses a path.
- Components keep the existing ids, classes, labels and ARIA attributes, so the stylesheet and accessibility behavior carry over. Cards are keyed by Run id so Preact keeps their DOM, focus and scroll.
- All text goes through Preact text nodes; no `dangerouslySetInnerHTML`. Links stay limited to `http(s)`.
- The server API, the Run record and the stylesheet are unchanged.

## Testing Decisions

Parser tests import `markdown.js` directly. Behavior tests drive the real page in Chromium through ChromeDriver with a stub server, using one shared helper, and skip when they are unavailable, like the existing browser tests. They replace the fake-DOM tests and cover tooltips and intro, Done collapse and its persistence across polls, Merge and Delete confirmations, bulk delete, theme selection and persistence, focus and scroll preservation, and detail rendering. Server tests cover the new allow-list. Run `npm test`.

## Out of Scope

New Dashboard features, a bundler or TypeScript, changes to the server API, visual redesign and server-side rendering.
