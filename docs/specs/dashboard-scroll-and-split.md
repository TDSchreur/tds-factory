# Dashboard keeps the scroll position, in several files

## Problem Statement

When I scroll down in the Run detail panel to read a file, the next automatic refresh puts me back at the top. A live Run changes its `updated` time all the time, so the panel is rebuilt every few seconds, and reading a long file is impossible. The cause is that the rebuild swaps in short "Loading..." placeholders. The page shrinks for a moment and the browser moves the scroll position to the top.

The whole Dashboard is also one HTML file with the styles, the Markdown parser and the application script inside it. It is already over 500 lines and every change has to edit the same file.

## Solution

When the Run that is already open refreshes, the panel stays on screen until all its files have loaded, then swaps to the new content in one step. The page never shrinks, so the scroll position holds. Opening a Run, or switching to another one, still shows the "Loading..." placeholders right away.

The Dashboard moves into a `dashboard/` folder of four files: `index.html` for the markup, `style.css`, `markdown.js` for the Markdown parser and `app.js` for the board, the detail panel and polling. The small theme script stays inline in `index.html` so the right theme applies before the first paint. There is no build step and no framework.

## User Stories

1. As a developer watching a live Run, I want my scroll position in the detail panel to stay put when the page refreshes, so that I can read a long file
2. As a developer, I want the open Run's files to update in place when they change, so that I see new content without losing my place
3. As a developer, I want opening a Run to show "Loading..." right away, so that I know the files are on their way
4. As a developer, I want switching to another Run to show that Run's panel straight away, so that I never see the old Run's files under the new title
5. As a developer, I want a file that fails to load to keep showing its error message, so that I know why it is empty
6. As a developer, I want an expanded Done card to stay expanded after the board is rebuilt, so that the refresh fix does not undo earlier behavior
7. As a developer, I want the Dashboard to look and behave exactly as before the split, so that the refactor costs me nothing
8. As a maintainer, I want the styles, the Markdown parser and the application script in separate files, so that each change touches one small file
9. As a maintainer, I want the server to serve only the four Dashboard files, so that no other file in the project can be reached through it
10. As a maintainer, I want the Dashboard installed with the package, so that `tds-factory dashboard` works after `npm install -g .`
11. As a maintainer, I want the Dashboard to keep working with no build step, so that a checkout runs as it is
12. As a maintainer, I want a missing Dashboard install to show the existing fallback page, so that a broken install still explains itself

## Implementation Decisions

- Two Tickets in one PR. The split is a refactor with no behavior change and lands first. The scroll fix is built on top of it.
- The Dashboard moves from one `dashboard.html` file to a `dashboard/` folder: `index.html`, `style.css`, `markdown.js` and `app.js`. All scripts are classic scripts. The parser keeps its single global function; the application script uses it.
- The theme-init script stays inline in `index.html` so the page does not flash the wrong theme.
- The server serves `/` from `index.html`, as it does for the page today. It serves `/style.css`, `/markdown.js` and `/app.js` from an exact allow-list of names, never from a path taken from the request, with the right content types. Every other path keeps its current meaning. The existing fallback page for a missing install stays.
- The package lists the `dashboard` folder instead of `dashboard.html` among its published files.
- The detail panel remembers which Run it is showing. When the Run to render is the one already shown, it builds the new content off screen, waits for every file to load or fail, and swaps it in once. A newer refresh that arrives meanwhile wins. A different Run, or the first open, swaps immediately and shows the placeholders as before.
- The behavior is documented in the README and the earlier Dashboard Specs only where they name `dashboard.html`; those mentions are updated to the new folder.

## Testing Decisions

- A good test checks behavior a user sees: the scroll position after a refresh, what the server returns for a path, what the parser returns for text. It does not check how the files are laid out.
- Ticket 1: the seven existing tests that read `dashboard.html` read the new files instead, and keep passing unchanged in what they assert. A new server test checks that each allowed name returns its content with the right type, that a path outside the allow-list or with traversal returns 404, and that the fallback page still shows when the folder is missing.
- Ticket 2: a headless-Chromium test, in the style of `test/dashboard-dialog-browser.test.js`, opens a long Run, scrolls down, changes the Run's `updated` several times and asserts the scroll position holds. It uses a current date so the Run is not hidden under older Runs, skips when Chromium is not installed, and must fail without the fix. The fake DOM in `test/dashboard-collapse.test.js` gains `createDocumentFragment` so the existing tests keep running.
- Prior art: `test/dashboard-dialog-browser.test.js`, `test/dashboard-collapse.test.js`, `test/dashboard.test.js`.

## Out of Scope

- Websockets, Server-Sent Events or any push channel
- A build step, bundler, framework or ES modules
- Changing the look, the polling interval or any server route other than the new file routes
- Further splitting of `app.js`

## Further Notes

Cause confirmed in a headless browser: during the rebuild the page height drops from about 4105px to 557px, which clamps the scroll position to 0. Static data never triggers it, only a changing `updated`.
