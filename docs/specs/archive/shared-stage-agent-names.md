# Shared Stage and Agent target names

## Problem Statement

Stage file ordering omits Prepare, and Agent target names are maintained in more than one place. These lists can drift from the Flow and installer.

## Solution

One module owns the ordered Stage and Agent target names. Consumers use those names for validation and ordering.

## User Stories

1. As a Dashboard user, I want Stage files ordered in Flow order, so Prepare appears between Define and Build.
2. As a Dashboard user, I want numbered Check files ordered numerically and unknown files last, so Run history is easy to follow.
3. As a Factory user, I want Run validation and installation to agree on Agent targets, so supported targets do not drift.
4. As a Factory user, I want existing target paths and the `all` selection to remain unchanged, so installations continue to work as before.

## Implementation Decisions

- A shared module owns the ordered Stage and Agent target names, used by Run validation, Dashboard ordering and installer target validation.
- Stage ordering recognizes each Stage's Markdown file and numbered Check summaries; unrecognized files follow known Stage files.
- `all` remains an installer selection rather than an Agent target, and still installs Claude and Codex only.
- Preserve existing public behavior and error handling apart from recognizing Prepare in Stage file order.

## Testing Decisions

- Exercise Run file ordering through the Dashboard's existing public interface, including Prepare, numbered Check files and unknown files.
- Use existing Run validation and installer tests to verify supported Agent targets and installation behavior. Tests assert observable behavior rather than internal implementation.

## Out of Scope

- Changing the Flow, adding Agent targets, or changing installation paths.
