# Dashboard: focus ring test waits for the detail focus

## Problem Statement

The browser check of #373 failed once in `a hovered or selected card keeps its inner focus ring` (`test/dashboard-a11y-browser.test.js`): the selected and focused card showed the brand selection ring without the focus ring, while the same job had passed on main minutes before and the test passes locally. The failing value was exactly the brand selection ring, the value before the focus ring is applied. Two timing dependencies of the test can produce it on a slow runner, and the failure could not be reproduced locally to tell which: (1) selecting a card opens the Run detail, which moves the focus to its heading in an effect that runs after the next frame, so it can run after the test's `focus()` and take the focus from the card; (2) the test emulates `prefers-reduced-motion` so that no transition is running, but it did not wait until the emulation had taken effect, and a box-shadow transition that has just started still reads its old value.

## Solution

The test waits for what it depends on instead of assuming it: until the emulation has taken effect, and until the Run detail has taken its focus, before it focuses the card and reads the ring. This removes both timing dependencies.

## User Stories

1. As a maintainer, I want the focus ring test to give the same result on a slow CI runner as on my machine, so that a red check means a real regression.
2. As a maintainer, I want every browser test that reads a colour or a shadow to wait for the reduced-motion emulation, so that none of them reads a value from a transition that has just started.

## Implementation Decisions

- A helper switches `prefers-reduced-motion: reduce` on, with optional extra media features, and waits until the media query matches and a button's computed transition duration is `0s`. The tests that emulate reduced motion to read a colour or a shadow use it; the dedicated reduced-motion test and the plain forced-colours test keep their own emulation because they test the emulation itself or another media feature.
- In the focus test, after the click, the test waits until the Run detail heading has the focus, then focuses the card.
- The change is in the test only. No change to `src/` or `dashboard/`.

## Testing Decisions

- The assertions of the tests are unchanged; only their waits change. The focus test still fails on the stylesheet before #360 (proved when #360 was made).
- The failure was not reproduced locally, so the fix is not proven against the original failure. If the check fails again it needs a new diagnosis.

## Out of Scope

Changes to the Dashboard, to the stylesheet or to `test/browser.js`.
