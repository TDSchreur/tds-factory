# Install selections own destination cleanup

**Status: accepted.** `tds-factory install` implements this decision on Linux and Windows. `update` and the Bootstrap installers still call `install` without a choice until issue #568 lands.

The Factory used to install for every Agent target unless the user named one. Installs and Updates instead ask users to choose install destinations, remember that selection and ask for confirmation or changes next time. Separate Claude directories are separate destinations; discovered directories are candidates and are never selected automatically. Unattended use requires explicit destinations or an explicit request to reuse the saved selection.

When deselecting a previously installed destination removes Factory-owned Skills and Stage agents there, with edited Factory files backed up first. We chose cleanup over leaving obsolete installations active because agents can continue loading those copies. Ownership must be established from Factory install records or markers, including installations made before saved selections existed; unrelated files and agent configuration remain untouched.

Global and project installs keep separate selections. Copilot receives its own skills even when Claude or Codex is also selected, so its destination can be managed independently, although Copilot can still discover skills from shared directories. Cancelling an Update leaves the CLI, installed files and saved selection unchanged; a bootstrap installer may already have installed the CLI before selection starts. Both bootstrap scripts remain thin callers of shared CLI logic, as described in [ADR 0009](0009-bootstrap-installers-are-release-assets.md).

The internal cleanup foundation refuses calls without an explicit assertion that the caller has established trusted paths. `install` establishes them with `src/trusted-install-paths.js` (Linux and Windows adapters) before any write and refuses other systems, including macOS; see the [integration Spec](../specs/install-destination-selection-integration.md). Identity and content rechecks detect ordinary changes but cannot supply atomic isolation from a concurrent filesystem writer.
