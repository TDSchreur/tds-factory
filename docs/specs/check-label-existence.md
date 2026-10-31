# Check that a label exists before asking to create it

## Problem Statement

When the Factory cuts Tickets it needs the `ready-for-agent` label. The Define step says to ask the user before creating a label that does not exist, but it does not say how to find out whether the label exists. In one Run the agent claimed `ready-for-agent` was missing, asked the user to create it, and `gh label create` then failed with "already exists". The label had been on the repository for days. The user was asked a question that had no real answer.

## Solution

Say how to check. The agent looks the label up by exact name before it asks anything, asks the user only when the lookup finds nothing, and treats an "already exists" failure from `gh label create` as proof the label is there.

## User Stories

1. As a user, I want the agent to look a label up before it asks me about it, so that I am not asked to create a label that exists.
2. As a user, I want to be asked only when the lookup finds no label with that exact name, so that a question always means something is missing.
3. As a user, I want an "already exists" error from `gh label create` to count as success, so that a stale lookup never stops the Run.
4. As a new user following the install guide, I want the label step to say the same thing as the Factory Skill, so that I know what the agent will do.
5. As a maintainer, I want the change in a changelog fragment, so that the release notes mention it.

## Implementation Decisions

- The Define step of the Factory Skill names the lookup: `gh label list --search <name> --json name`, matching the exact name in the output, since a search also returns labels that only contain the text.
- The agent asks the user to create the label only when no result matches exactly. It never runs `gh label create` before the lookup.
- When `gh label create` fails because the label already exists, the agent treats the label as present and continues.
- The install guide's label step describes the same behaviour in the same words.
- The tracker is GitHub for this wording; other trackers keep "If a label the tracker needs does not exist, ask the user".

## Testing Decisions

- `npm test` already checks the Skills, the guides and the changelog fragment; it must still pass.
- A test in the existing Skills test file asserts that the Factory Skill and the install guide both name the lookup command and the "already exists" rule, so the two cannot drift apart.

## Out of Scope

Changing how Tickets are labelled, creating labels automatically without asking, or checking labels other than by exact name.
