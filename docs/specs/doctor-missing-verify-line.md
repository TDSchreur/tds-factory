## Problem Statement

A project whose `AGENTS.md` or `CLAUDE.md` has a `## Commands` section but no `- Verify:` line gets `fail` from the Doctor, with the message "the Verify command is empty". That is wrong twice. The Verify command is not empty, it is absent, and an absent Verify command is something the user can supply, which the Doctor reports as `missing`. The message also does not say what to write, so a user who put the command in a code block under a comment line cannot tell why it is not read.

## Solution

The Doctor reports `missing` for the `verify-command` check whenever the Conventions file has no `- Verify:` line, with or without a `## Commands` section. The message names the line to add, for example "- Verify: `npm test`", and says that a command in a code block is not read. `fail` stays for a Verify command that is present but unusable: empty, containing a NUL byte, or starting with a word that cannot be found.

## User Stories

1. As a Factory user whose `## Commands` section holds the command in a code block, I want the Doctor to say the Verify command is missing, so that I know to add the line.
2. As a Factory user, I want the message to show the exact line to add, so that I do not have to find the format in the docs.
3. As a Factory user, I want the message to say a code block is not read, so that I understand why my existing command was not found.
4. As a Factory user with `- Verify: ``` (an empty command), I want a `fail` that says the command is empty, so that a present but unusable command is still told apart from an absent one.
5. As the `factory` Skill, I want `missing` for an absent Verify line, so that I create the Run with an empty `commands` and ask the user once, instead of stopping at a `fail`.
6. As a Factory developer, I want a regression test for a `## Commands` section without a `- Verify:` line, so that absent and unusable stay distinct.
7. As a user whose project already passes, I want no change in the result or the message.

## Implementation Decisions

- The Doctor's Verify command check treats "no `- Verify:` line found" as an absent command in every case, including when a `## Commands` section exists. The cause was a no-match result being carried on as an empty value instead of an absent one.
- The `missing` message keeps its current wording and adds the line to write and the note that a command in a code block is not read.
- The Verify line format does not change. The `factory` Skill and the install and usage guides define the Verify command as the `- Verify:` line, and the Skill says the agent reads the same line the Doctor read. Reading a command from a code block would be a separate feature.
- No change to `GLOSSARY.md` or the ADRs: Doctor, `missing` and Verify command are already defined as intended.

## Testing Decisions

- The seam is the Doctor report for a project directory, the same one the existing Verify command tests use. A good test asserts the check's status and message, not how the line is found.
- Add a case in the existing "missing from malformed or unusable" test: a `## Commands` section with a code block and no `- Verify:` line is `missing`, and its message mentions `- Verify:`. It fails on the current code.
- The existing `fail` cases (empty, NUL byte, command not found) and the `pass` cases stay as they are.

## Out of Scope

- Reading the Verify command from a code block or any other layout.
- Changing how the `factory` Skill or the Run record use the command.
- Checking other conventions sections.

## Further Notes

Reported by a user on Windows whose `AGENTS.md` has the command `.\local_build_and_test.ps1 -SkipIntegrationTests` in a PowerShell code block. The same project will pass once it has a `- Verify:` line.
