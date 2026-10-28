# Dashboard explanations

## Problem Statement

Colleagues new to the Factory see Stage columns, verdict chips and loop counts on the Dashboard without knowing what they mean.

## Solution

The Dashboard explains itself. Each Stage column heading and each card chip carries a tooltip. A collapsible "What is this?" section under the header explains what the Factory does, the Stages in order and how to read a card.

## User Stories

1. As a new colleague, I want a tooltip on each Stage heading, so that I learn what happens in that Stage.
2. As a new colleague, I want tooltips on the tickets, Standards, Spec, Security, Infrastructure and loop chips, so that I know what they measure.
3. As a new colleague, I want a short introduction to the Factory on the page, so that I understand the board without other docs.
4. As a keyboard user, I want the explanation available without a mouse, so that the intro is a native disclosure and Stage headings can be focused.
5. As an experienced user, I want the intro collapsed by default, so that it does not take space.

## Implementation Decisions

- Stage and chip descriptions live in one lookup in `dashboard.html`, shown with the native `title` attribute. No dependency or server API.
- Stage headings get `tabindex="0"` so keyboard users can reach the tooltip.
- The intro is a native `<details>` element placed between header and board, collapsed by default, written in plain language and consistent with `GLOSSARY.md` terms.
- Existing card and column behavior is unchanged.

## Testing Decisions

Test through the existing fake-DOM seam in `test/dashboard-controls.test.js` style: every Stage heading and rendered chip has a non-empty title, and the page HTML contains the intro. Run `npm test`.

## Out of Scope

Custom tooltip widgets, localization, per-run help and a guided tour.
