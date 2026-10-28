# Auto-approve Define steps

## Problem Statement

Factory Runs pause for approval after the Spec and Ticket breakdown, even when the user has already approved the work during grilling.

## Solution

Keep the user's approval at the end of grilling. In Factory Runs, proceed through Spec writing and Ticket creation without additional approvals.

## User Stories

1. As a Factory user, I want to approve the shared understanding after grilling, so that the work reflects my intent.
2. As a Factory user, I want the Spec and Tickets created without further sign-off, so that the Run can continue without redundant pauses.
3. As a user of the standalone skills, I want their existing workflows preserved, so that this change only affects Factory Runs.

## Implementation Decisions

- Override the Spec and Ticket skills' user consultation and approval steps within Factory, while retaining their substantive drafting and publishing work.
- Keep other Factory approval points and the requirement to ask before creating a missing tracker label.
- Update the Run waiting instructions to match the new Define flow.

## Testing Decisions

- Check the Factory instructions and existing skill tests to verify the override and prevent conflicting approval instructions.
- Run the repository's test suite.

## Out of Scope

- Changing standalone Spec or Ticket skills, other approval points, or tracker configuration.
