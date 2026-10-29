# Manual releases

## Problem Statement

Publishing every merged change creates too many GitHub Releases.

## Solution

A maintainer chooses when to publish a tested release from `master` using GitHub Actions. Document the process and retain the existing install URL and versioning scheme.

## User Stories

1. As a maintainer, I want merges to leave releases unchanged so I can batch changes.
2. As a maintainer, I want to launch a release from GitHub Actions when changes are ready.
3. As a maintainer, I want clear release instructions, including how to check the result.
4. As a colleague, I want the existing latest-release install URL to keep working.

## Implementation Decisions

- Replace the push trigger with a manual workflow dispatch; restrict publishing to the default branch.
- Preserve tests before publishing, version selection, generated notes, serialization and the fixed asset name.
- Update release documentation and the prior release specification and decision to reflect the new policy.

## Testing Decisions

- Use the existing workflow contract test to verify manual triggering, default branch restriction and preservation of the publishing safeguards.
- Run the project's verify command. GitHub Actions execution cannot be validated locally.

## Out of Scope

- Scheduling releases, publishing to a registry, and changing the versioning algorithm.
