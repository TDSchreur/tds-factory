# Dashboard card redesign

## Problem Statement

A Done card on the Dashboard stacks seven loosely related rows. Its buttons have the same faint outline as the card, so Merge, Delete and Show details are hard to see, and the card looks cluttered.

## Solution

Group the card into a title, one meta line, the chips and a row of actions. Give the buttons clear roles: Merge is filled, Delete is outlined in the warning color, Show details is a link-style toggle with a chevron. The pull request state becomes a colored badge.

## User Stories

1. As a user, I want Merge to stand out, so that I see the one safe next step for an open pull request.
2. As a user, I want Delete to look like a warning action and sit apart from Merge, so that I do not click it by accident.
3. As a user, I want all buttons and selectors to have a visible outline in both themes, so that I can see they are clickable.
4. As a user, I want the update time and agent on one line under the title, so that the card reads top to bottom.
5. As a user, I want the pull request state as a badge (Open, Merged, Closed) next to the link, so that I see it at a glance.
6. As a user, I want Show details to read as a toggle with a chevron, so that it is not mistaken for an action.

## Implementation Decisions

- Card order: reason, title, meta (Updated, Agent, Abandoned badge), then activity and chips. Done cards put activity, chips, the pull request row and the actions row inside the collapsible details.
- Actions sit in one row at the bottom of the details: Merge (filled, primary color), Delete (outlined, warning color).
- Add a stronger border token for buttons and selectors in the light and dark themes.
- Text, labels, aria attributes and the toggle text stay as they are, so voice control and tests keep matching.
- No change to the server, the Run record or the Stage columns.

## Testing Decisions

Test through the real page in Chromium with the shared helper: the meta line, the badge, the actions row and that Merge, Delete and the toggle differ visibly from the card. Run `npm test`. Check both themes with a screenshot.

## Out of Scope

New card information, drag and drop, changes to the Run detail view and the dialogs.
