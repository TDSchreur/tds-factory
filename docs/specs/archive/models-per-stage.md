# Models per Factory Stage

## Problem Statement

A Factory Run uses the main agent's model for most Stages, so users cannot choose different models for work with different reasoning and cost needs. Users cannot see the Stage model choices in the Flow diagram.

## Solution

Support configurable Stage model choices for Codex, Claude Code, and Copilot CLI. Use target-specific agents and handoffs where needed, and show the defaults in the README diagram. Clearly report when a requested model cannot be used or its actual selection cannot be verified.

## User Stories

1. As a Factory user, I want each Stage to use a suitable model, so that I can balance quality, speed and cost.
2. As a user of any supported Agent target, I want to configure its model choices, so that they match my account and preferences.
3. As a user, I want the Define interview and confirmation to remain interactive, so that the Spec reflects my decisions.
4. As a user, I want Build to complete every Ticket and Check to retain three independent read-only reviews, so that model routing does not weaken the Flow.
5. As a user, I want unavailable or unverifiable model choices reported, so that I know when routing differs from my configuration.
6. As a reader, I want the README Flow diagram to show the default model choices, so that I can understand the routing.

## Implementation Decisions

- Use each target's native agent configuration and dispatch rather than claiming that skill text switches the main agent's model.
- Preserve the main agent as coordinator for human interaction and Run record ownership; relay Define questions and answers when required by the client.
- Preserve approval points, Ticket commits, review independence, Check loops and PR approval. Prepare can share a model handoff with an adjacent Stage.
- Provide editable model defaults for each target; model availability and actual execution depend on client, account and policy. Report substitution or inability to verify rather than asserting a model was used.
- Support Copilot CLI; do not claim identical behavior in other Copilot environments.
- Install target-specific configuration without overwriting user-owned configuration.

## Testing Decisions

- Test installation and preservation of user-owned agent files through the installer interface using temporary project directories.
- Verify configuration and Flow documentation against supported client formats; run the existing test suite.
- Document any live-client verification that cannot be performed.

## Out of Scope

- Benchmarking models or guaranteeing cost savings; supporting every Copilot environment.
