# Deepen Run record behavior

## Problem Statement

Agents manually maintain Run records while the Dashboard independently interprets their fields. Changes to the Flow require coordinated edits and can leave records inconsistent or the Dashboard out of step.

## Solution

Give the Factory shared Run record behavior for creating and updating records and for interpreting them in the Dashboard. Require the Factory tooling for new Runs, while keeping older, incomplete and unreadable records visible without migration.

## User Stories

1. As a developer, I want agents to create and update Run records using Factory tooling, so that record rules are consistently applied across Agent targets.
2. As a developer, I want a clear setup instruction if the tooling is unavailable, so that a Run does not silently fall back to manual writes.
3. As a developer, I want updates to preserve unchanged and unknown fields, so that older and future records do not lose information.
4. As a developer, I want changed values validated and waiting fields consistent, so that updates cannot create invalid record state.
5. As a developer, I want failed or interrupted writes to leave the prior record intact, so that a Dashboard read does not see a partial replacement.
6. As a developer, I want old, incomplete and unreadable records displayed with existing defaults, so that history remains visible without migration.
7. As a developer, I want the Dashboard offline and read-only, so that it does not need a network or interfere with Runs.
8. As an agent, I want to retain responsibility for Flow decisions and review judgments, so that tooling records decisions without making them for me.
9. As a developer, I want the existing Run lifecycle, summaries and timestamps maintained, so that the Dashboard stays current.

## Implementation Decisions

- Concentrate record creation, updates, validation and tolerant interpretation in shared Run record behavior, used by Factory tooling and the Dashboard.
- Require the Factory command before creating a Run. If unavailable, stop and provide setup guidance; do not use a manual fallback.
- Preserve the existing record shape and Dashboard presentation, including unreadable cards and the Define default for unknown Stages. Do not require migration.
- Validate changed values and enforce consistency of status and waiting fields; preserve unchanged fields, including unknown fields, when updating older records.
- Replace records atomically, preserving the previous record if a write fails or is interrupted. Preserve created timestamps and refresh updated timestamps on writes.
- The agent still chooses Stage transitions, evaluates reviews, writes summaries and decides what activity to record. The tooling does not decide Flow policy.
- Retain the Dashboard's loopback-only, read-only, offline behavior and its existing file safety protections. Update the canonical Dashboard Spec to reflect changed ownership.
- The installed Skill tells every Agent target how to use the tooling and retains the existing lifecycle obligations.

## Testing Decisions

- Test externally observable behavior through the command and Dashboard HTTP interfaces, using temporary projects and representative old, incomplete, unreadable and new records. Tests assert outcomes rather than internal implementation.
- Cover creation, updates, validation, preservation of fields, waiting consistency, failed writes, and Dashboard interpretation. Keep existing safety and regression tests.
- Use the existing Node test runner and temporary project patterns.

## Out of Scope

- Changing Flow decisions, review policy, Dashboard appearance, or migrating old records.
- Remote Dashboard access, a Dashboard write interface, new dependencies or a build step.
