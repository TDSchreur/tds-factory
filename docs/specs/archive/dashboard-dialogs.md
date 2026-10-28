# Dashboard dialogs

## Problem Statement

Browser-native confirmation and error pop-ups interrupt the Dashboard with a style that does not match the interface.

## Solution

Use a consistent, accessible Dashboard dialog for merge and delete confirmations and errors. Match the selected theme and make the affected action and Runs clear.

## User Stories

1. As a Dashboard user, I want a clear merge confirmation naming the Run and pull request so I can confirm the intended action.
2. As a Dashboard user, I want delete confirmations to name the affected Run or count so I understand what will be removed, including hidden Runs.
3. As a Dashboard user, I want errors shown in the same style so I can understand failures without a browser alert.
4. As a keyboard user, I want focus contained in the dialog, Escape to cancel, and focus restored when it closes.
5. As a user of either theme or a small screen, I want the dialog to remain legible and usable.

## Implementation Decisions

- Replace Dashboard browser-native confirmations and alerts with a themed in-page modal dialog. Retain explicit confirmation before merge and delete and the current request and error behavior.
- Clearly label the action and consequences; do not execute actions when canceled. Preserve the full error detail for failed operations.
- Use accessible dialog semantics, visible focus, keyboard operation and focus restoration. The modal remains usable when the board refreshes.

## Testing Decisions

- Test observable confirmation, cancellation, request, error and keyboard behavior through the existing Dashboard UI seam. Preserve existing API tests.
- Verify the visual layout in both themes and narrow view if a browser is available. Run the project verify command.

## Out of Scope

- Changing merge or deletion server behavior.
