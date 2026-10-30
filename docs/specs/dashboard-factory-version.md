## Problem Statement

The Dashboard does not identify the Factory version serving it. Users must leave the page and check the CLI to know which version they are using.

## Solution

Show a small `vX.Y.Z` label beside the logo in the Dashboard header. It identifies the Factory installation serving that Dashboard and remains visible when there are no Runs.

## User Stories

1. As a Factory user, I want to see the Factory version on the Dashboard, so that I can identify the installation I am using.
2. As a Factory user, I want the displayed version to match that installation's CLI version, so that support and troubleshooting use the same reference.
3. As a Factory user viewing a project with no Runs, I want the version to remain visible, so that identifying the installation does not depend on Run history.
4. As a Factory user viewing another project, I want the version to describe the serving Factory rather than the project, so that unrelated project versions do not mislead me.
5. As a Factory user on a narrow screen or using another theme, I want the version to remain readable alongside the existing header, so that the page remains usable.

## Implementation Decisions

- The version comes from the serving Factory's package metadata, the same source used by its CLI version command. Do not read the current project's package metadata or store versions in Run records.
- Extend the existing Dashboard information response with the Factory version while retaining the project information.
- Pass that value through the existing page state to the header and display it as plain text with a `v` prefix beside the logo.
- The label is independent of the list of Runs. If version information is absent or unavailable, omit the label rather than inventing a version; the Dashboard continues to work.
- Preserve the existing project pill, browser title, controls, responsive layout, and theme behavior.
- Update the Dashboard guide to describe the label and information response.

## Testing Decisions

- Test observable behavior at the existing Dashboard HTTP and browser seams rather than private helpers or exact markup structure.
- The server test verifies that the information response returns the serving Factory's actual package version, including when the served project's own package has a different version.
- Header browser tests verify the visible version label with and without Runs and its absence when version data is unavailable.
- Use existing header responsive coverage to verify that the added label does not cause horizontal overflow on a narrow screen.
- Run the project's Verify command, `npm test`.

## Out of Scope

- Checking for updates, release links, upgrade controls, or notifications.
- Git commit hashes, versions per Run, project versions, or agent versions.
- Changing the browser tab title or the Factory release/versioning process.

## Further Notes

The user confirmed the serving installation as the version source, the header placement beside the logo, and visibility without Runs. This is one vertical Ticket. No ADR is needed for this reversible display change.
