# Fluent 2 decision

## Problem Statement

The Dashboard redesign for milestone v0.6.0 follows Fluent 2, which is a design language, not one library. Before the restyle (items D6 and D7) the team has to decide how to adopt it: translate its design tokens into the Dashboard's own CSS and hand-build the components (option A), or vendor the Fluent web components inside the Preact tree (option B).

## Solution

Prototype one card, one button set and one drawer header both ways, measure what each costs, and record the decision in [ADR 0025](../adr/0025-the-dashboard-adopts-fluent-2-through-design-tokens.md): option A, with the token values taken from the MIT-licensed `@fluentui/tokens` package and its notice added to `THIRD-PARTY-NOTICES.md`. The Run changes only documents; the Dashboard does not change, and the throwaway prototype code is not committed.
