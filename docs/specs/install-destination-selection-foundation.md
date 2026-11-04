# Install destination selection foundation

## Problem statement

Factory currently installs to every Agent target by default. The user wants to choose destinations, including several Claude directories, and to keep those choices for later confirmation. Selection must eventually remove Factory-owned files from deselected destinations while preserving unrelated content and backing up edits.

The cleanup foundation exists, but the caller must establish a trusted filesystem boundary before invoking it. Selecting a destination cannot be exposed as an install command change until deselection and cleanup are integrated. This Spec therefore defines a selection foundation that does not change the commands.

## Solution

Add a reusable internal operation that discovers install destination candidates, validates an explicit desired selection and reads and writes selection records in caller-supplied locations. Separate global and Project records and make changes observable through a dry-run plan. A later Run integrates prompts, installation and trusted cleanup. The existing CLI and Bootstrap behavior remain in effect until that integration lands.

## User stories

1. As a user with several Claude directories, I want each discovered directory represented separately so I can select either or both.
2. As a user with a configured Claude directory outside my home, I want it offered alongside standard directories.
3. As a user with a nonstandard Claude directory, I want to specify its path explicitly.
4. As a user installing for a Project, I want its selection separate from my global selection and from other Projects.
5. As a user returning to install, I want my earlier choices available for confirmation and new candidates left unselected.
6. As an existing user, I want destinations with Factory-owned files identified so I can decide whether to retain them or remove their owned files later.
7. As an unattended user, I want to provide the complete desired selection or explicitly request saved choices; I do not want an implicit all-target fallback.
8. As a user who cancels or previews, I want existing installations and selection records left unchanged.
9. As a user with an unreadable or malformed record, I want the operation to report the problem without replacing that record or choosing destinations silently.
10. As a developer, I want a structured plan with selected, deselected and newly discovered destinations so the later CLI can confirm and reconcile the same choices.

## Implementation decisions

- Keep the selection foundation separate from `install`, `update` and the Bootstrap installers. No command calls the cleanup operation or changes its existing default in this Run. The user-approved destination prompts and cleanup are delivered by the follow-on integration Run.
- A destination identifies an Agent target and its concrete Skills and Stage agent locations. A Claude global configuration directory is part of the destination identity; a Project destination uses the Project's existing target paths. Codex and Copilot have their own destinations. Resolve configured relative Claude paths against the invocation working directory, consistent with the existing Claude configuration behavior.
- Discover the configured Claude directory, the default Claude directory and existing home directories named `.claude-*`; present discovered filesystem entries as candidates, not proof that Claude uses them. Also accept an explicit custom Claude path. Inspect known destinations for Factory ownership markers or recorded Stage agents, without following untrusted links or modifying files. Never infer ownership from filenames alone.
- Initial selection has no choices preselected. Previous choices are identified separately so an interactive caller can present them for confirmation. New discoveries remain unselected. Legacy owned destinations are identified as existing installations but are not silently selected or removed.
- Validate Agent target names, path inputs and persisted records before planning or writing. Reject malformed, unknown or conflicting records with an actionable error; do not silently discard entries, fall back to `all`, or turn invalid input into a cleanup target. Deduplicate destinations by canonical path identity where that can be established and fail rather than guessing when identity is ambiguous. Preserve saved destinations that are temporarily missing so an unmounted directory is not forgotten or cleaned up on a guess.
- An explicit destination selection is the complete desired set. Reuse of a saved selection is a separate explicit request. A dry-run or cancelled selection performs no writes. Global records and each Project's records are separate; callers supply the record path and filesystem context so tests never touch the real home directory or Project registry. Record writes require an explicit trusted-path assertion from a caller that has established that untrusted principals cannot replace the record path or its ancestors; command integration must enforce that boundary or refuse writes. Use a staging file in a temporary directory under the record's parent and atomic replacement for a successful record write, and preserve the existing record when validation or writing fails.
- The plan reports desired destinations, previously selected destinations no longer desired, candidate destinations and legacy ownership evidence. Planning does not delete, copy, install or call `cleanupDestination`; no persisted path authorizes a later deletion by itself.
- **Security boundary for the later integration:** before passing `trustedPaths: true` to `cleanupDestination`, the command must establish that untrusted principals cannot replace the destination or backup path, including effective filesystem ACLs and parent rename/delete permissions, on each supported operating system. Permission bits alone are insufficient. A caller that cannot establish the boundary must refuse cleanup before applying a changed selection. The platform-specific mechanism remains an unresolved implementation prerequisite; neither this Spec nor an environment variable proves it. Do not substitute optimistic rechecks for atomic filesystem protection or silently skip required cleanup.
- Use Node's built-in path, filesystem and JSON APIs for this foundation. Define the on-disk record schema explicitly in the implementation and validate it at its boundary; do not add a custom parser for a more complex path or expression language. Adversarial tests are required for traversal, malformed records, symlinks, aliases, very long names and unreadable paths. The later trusted-path mechanism needs its own defined, tested OS-specific approach before integration.
- **Documents:** update this Spec and `changelog.d/` for this internal foundation. Read the current descriptions in `docs/install.md`, `docs/usage.md`, `docs/development.md`, `docs/capabilities.md`, `docs/specs/one-line-installers.md`, `docs/specs/claude-config-dir.md`, `docs/specs/install-destination-cleanup.md`, `docs/adr/0037-install-selections-own-destination-cleanup.md`, `GLOSSARY.md`, `README.md`, `src/cli.js` and `skills/add-project-review/references/project-reviews.md`. Preserve their descriptions of current command behavior until integration; update only statements made stale by this foundation. The integration Spec must revisit the install guide, canonical Specs, CLI help and Bootstrap descriptions.

## Testing decisions

Exercise discovery, selection validation, planning and record persistence through one internal disk-boundary interface with isolated temporary homes and Projects. Assert the returned candidates, plans and durable record contents rather than private helper calls. Cover separate Claude folders, configured and custom directories, missing saved destinations, legacy ownership, explicit all-target choices, duplicate or aliased paths, independent Project/global records, no selected destinations, cancellation and dry runs, malformed and unreadable records, write failure, malicious path and symlink inputs, and repeated runs. Preserve linked targets and unrelated files. Tests must run without a real agent installation or network and state platform-specific symlink skips explicitly.

## Out of scope

CLI prompting, noninteractive CLI flags, changing `install --agent` semantics, actual installation or cleanup, trusted-path enforcement, `update` and Bootstrap integration, and automatic deletion. They remain required follow-on work and must not be reported as delivered by this foundation.

## Size estimate

Estimates count the Spec, tests and documentation, excluding lockfiles and fixtures. Shared files are counted once.

| Work                                                      | Estimated files | Estimated diff |
| --------------------------------------------------------- | --------------: | -------------: |
| Define: Spec and supporting domain notes                  |               1 |           5 KB |
| Candidate discovery and planning with disk-boundary tests |               2 |           8 KB |
| Record validation, persistence and adversarial tests      |               2 |           9 KB |
| Documentation and changelog                               |               1 |           2 KB |
| Total                                                     |               6 |          24 KB |

A Full track Run with three or more Tickets needs a final documentation Ticket blocked by the others. The estimate is provisional until the coordinator determines the final Ticket graph.

## Further notes

The user confirmed multi-selection, remembered choices requiring confirmation, Claude directory discovery and custom paths, per-Project and global state, cleanup with backups, legacy discovery, dedicated Copilot skills, cancellation without selection or installed-file changes, and explicit unattended choices. An explicit selection replaces the whole saved selection. Later integration must implement these behaviors together, including cleanup when a destination is deselected.

[Issue #567](https://github.com/TDSchreur/tds-factory/issues/567) tracks destination selection. [Issue #568](https://github.com/TDSchreur/tds-factory/issues/568) tracks the subsequent Update and Bootstrap integration. The user approved splitting selection into this foundation and [secure CLI integration #576](https://github.com/TDSchreur/tds-factory/issues/576), followed by #568.
