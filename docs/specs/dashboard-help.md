# Dashboard: help panel and first-run welcome

## Problem Statement

A new user who opens the Dashboard meets six empty columns and a collapsed "What is this?" line that explains only the Stages and the "Needs you" banner. It does not say how to start a Run, what the Fast and Full track are, what the Check verdicts mean or what the action buttons do. This is the seventh item of the Dashboard work in milestone v0.6.0.

## Solution

A "Help" button in the header opens a help panel: a native dialog with short sections in the Factory's glossary terms. It replaces the old intro. When there are no Runs at all, a welcome card replaces the Stage columns and says how to start with `/factory`, with a link that opens the help panel. The text is static: no request, no route, no change to the Run record.

## User Stories

1. As a new user, I want a Help button in the header that opens a help panel, so that I can learn what the Dashboard shows without leaving it.
2. As a new user, I want the panel to explain the Stages, the Fast and Full track, what "waiting on you" means, the Check verdicts and Left open, in a few lines each, so that I can read it in a minute.
3. As a user, I want the panel to explain each action (Merge, Sync, Clean up, Accept Check and Grant extra loop) and when its button appears, so that I know what a click does before I click it.
4. As a keyboard user, I want the panel to open with the focus inside it, keep the focus inside until I close it, close with Esc or the Close button, and return the focus to the Help button, so that I never lose my place.
5. As a user on a phone, I want the panel to fill the screen with 44 px targets and scroll when the text is long, so that I can read it.
6. As a user with no Runs, I want a welcome card that says how to start (`/factory` and a sentence of what to build) instead of six empty columns, so that I know what to do next.
7. As a user with no Runs, I want a link in the welcome card that opens the help panel, so that the first step and the explanation are one click apart.
8. As a user, I want the welcome card to go away as soon as a Run exists, and not to show when a filter merely hides all Runs, so that it only appears on a first run.
9. As a user of light, dark, high contrast or reduced motion, I want the panel and the welcome card to follow the same tokens and rules as the rest of the Dashboard, with 4.5:1 text contrast.
10. As a maintainer, I want the help text to use only the Factory's glossary terms and no external request, so that the Dashboard stays consistent and private.

## Implementation Decisions

- `HelpPanel` is a component in `dashboard/components.js`, built like `ConfirmDialog`: a native `<dialog>` opened with `showModal()`, labelled by its heading, with a Close button that has the focus first. The header holds a `#help` button before the theme selector. The page state in `app.js` is a boolean `helpOpen`; closing (Esc or the Close button) sets it false and puts the focus back on `#help`. If a confirm dialog is open the Help button is not reachable, so two dialogs never stack.
- The content is a static list of sections in the component: Stages (the five Stages of the old intro), Tracks, Waiting on you, Check, Actions. The action list names Merge (squash and merge the open pull request of a done Run), Sync (rebase the Run branch onto the default branch of origin), Clean up (remove the Run worktree and branch after the pull request is merged), Accept Check (continue to Finish with a Check that is not clean) and Grant extra loop (one more Check loop when the limit is reached). Check explains the verdicts pass, fail and skipped, the Blocking finding and Left open. The words follow GLOSSARY.md; the Avoid terms of the glossary do not occur, and a unit test reads the panel text for them.
- The old `Intro` component, its styles, the `#intro` background selector of the detail drawer and the `#intro` measurement are removed. The drawer still starts below the header.
- `Welcome` is a component rendered by the page in place of the Stage navigation and the Stage columns only when the loaded list of Runs is empty (zero Runs before any filter, after the first successful load; not during Loading and not on an error). It holds a heading, the command `/factory <what you want built>` in a code element, one sentence on what happens next (the Run appears here and moves through the Stages) and a `button` styled as a link that opens the help panel. The Needs you button and its count stay in the header.
- Styling uses only the Fluent tokens of `dashboard/style.css`; no new token is needed. Text pairs are added to the browser contrast test. The panel shows in forced colours with system colours through the existing rules, and its transitions are none.
- At widths below the phone breakpoint the panel is full-screen like the Run detail, and its buttons and links are at least 44 px tall.
- `docs/dashboard.md` documents the Help button, the panel and the welcome card, and the "What is this?" line is gone from it. There are no screenshots: the repository has none. A changelog fragment is added.
- No change to `src/`, routes or the Run record.

## Testing Decisions

- A unit test in `test/dashboard-help.test.js` reads the help text exported from `dashboard/help.js` (the section data) and checks it names every Stage, both tracks, the five actions and the three verdicts, and that none of the glossary's Avoid terms occurs in it. `dashboard/help.js` is a plain data module, so the check needs no browser.
- Browser tests with the stub server (`test/dashboard-help-browser.test.js`): the Help button opens the dialog with the focus inside, Tab and Shift+Tab stay inside, Esc closes it and the focus returns to the button, the old `#intro` is gone; the welcome card shows with no Runs, holds the command and the link, the link opens the panel, and it is gone once a Run exists; it does not show when the Needs you filter hides every Run; at a phone width the panel is full-screen with 44 px targets.
- The contrast test also opens the panel and loads the welcome card, in both themes. The existing browser tests that referenced `#intro` are updated.

## Out of Scope

Hints on single Stages (the existing `title` hints stay), translations, help that depends on the Run, a tour, saving that the user has seen the help, and any change to the Run record or the routes.
