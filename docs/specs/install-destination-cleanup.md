# Install destination cleanup foundation

## Problem Statement

The planned install destination selection will let users stop installing to an Agent target or a Claude directory. Copies left in a deselected destination can continue to be loaded. Removing everything in that destination would also remove users' own files or changes, so selection needs a way to identify Factory-owned data, back up edits and remove only what it owns.

## Solution

Add an internal cleanup operation, tested against real temporary directories, as the first of three Runs. It identifies owned Skills and Stage agent files from existing installation evidence, backs up edits before deletion, and leaves unrelated data alone. This Run does not connect the operation to any command or change current installation behavior.

## User Stories

1. As a user who deselects a destination in the future, I want Factory-owned files removed, so that an obsolete copy is no longer loaded.
2. As a user with edited installed Skills or Stage agents, I want a backup before removal, so that my changes remain recoverable.
3. As a user with a legacy Skill marker without a hash, I want that entire Skill backed up, so that unknown edits are preserved.
4. As a user with my own files beside installed files, I want them left untouched, so that cleanup affects only proven Factory-owned data.
5. As a user with an old unrecorded agent file, I want it preserved, because its ownership cannot be established.
6. As a user with a malformed record or a failed backup, I want cleanup to stop before deleting anything, so that an error cannot silently destroy my work.
7. As a user previewing cleanup, I want no filesystem writes, so that a dry run is safe to inspect.
8. As a user retrying cleanup, I want it to be idempotent, so that already removed files do not cause a failure.
9. As a user with symbolic links in or around a destination, I want cleanup to preserve linked targets, so that it cannot escape the intended directories.
10. As a developer integrating selection later, I want one internal operation with explicit destination and backup paths, so that the same safety rules apply to global and project installs.

## Implementation Decisions

- Expose an internal `cleanupDestination({ skillsDir, agentsDir, backupRoot, trustedPaths, dryRun, ... })` operation. The caller supplies both destination directories and a backup root; the return value or output must make removed, backed-up and preserved items observable. This is an internal module interface, not a CLI option.
- A direct child Skill directory is Factory-owned only when its marker is a regular file. Examine all marked direct children, including stale Skills no longer shipped. A matching recorded SHA-256 identifies an unedited Skill; a different hash, a missing hash or an unusable hash requires backing up the complete Skill directory, including added user files and the marker, before removing it. Because historical hashes omit directory entries, also back up a Skill containing an empty directory, even if its recorded hash matches. Refuse special files such as FIFOs and sockets before any write or removal. Unmarked directories and other entries are preserved.
- A Stage agent is owned only if it is a regular file named in a valid `.tds-factory-agents.json` record whose value is a SHA-256 hash. Back up a file whose contents differ from its recorded hash. Preserve unrecorded files and entries that are not regular files. A missing record establishes no agent ownership.
- Validate the entire agent record before making any writes or deleting any Skill or agent: it must be a JSON object mapping safe basenames to valid SHA-256 hashes. Reject absolute paths, dot components, separators including both `/` and `\\` on every operating system, and any other invalid basename. Malformed records fail the operation. A missing destination is an empty destination.
- Complete every required backup successfully before deleting any owned data. Create a unique backup directory using an operating-system-created unique name under the supplied backup root, outside both destinations. Preserve complete edited Skill folders and edited agent files, and report the backup path. If any backup fails, report the failure and delete no owned data. A dry run creates no directories or backups and makes no changes.
- This internal operation requires an explicit `trustedPaths: true` assertion from a caller that has established that no untrusted security principal can modify the destination and backup paths. It refuses by default. This is not permission or ACL verification: command integration must establish that boundary using OS-appropriate checks or refuse cleanup. Arbitrary shared or attacker-writable paths are unsupported. Node filesystem operations do not supply atomic isolation from another process changing paths, and same-user concurrent changes are unsupported. Identity, content and ancestry rechecks before backup and removal detect ordinary changes and abort; they are not a substitute for the trust precondition.
- Subject to that trust precondition, do not follow symlinks in a destination's ancestors, destination directories, ownership markers, agent records or owned entries. Preserve linked targets and do not let a path or a symlink escape either destination or the backup root. Preserve symbolic links found within an edited Skill without following their targets. Validate paths and fail safely when the required containment cannot be established.
- Use Node's filesystem, path and crypto primitives; add no dependencies. Path validation is security-sensitive and needs adversarial tests for Unix and Windows forms on every supported host.
- A repeated successful cleanup has no further effect. Failures are reported to the caller rather than silently proceeding. The operation is not wired to `install`, `update`, bootstrap installers or a user interface in this Run.
- **Documents:** this Spec, the planned decision in `docs/adr/0037-install-selections-own-destination-cleanup.md`, and a changelog fragment describe the foundation. `docs/install.md`, `docs/specs/one-line-installers.md`, and the help in `src/cli.js` describe current commands and remain unchanged because this Run does not wire the operation to them. Revisit them when the follow-on Runs change those commands.

## Testing Decisions

Test the internal cleanup operation at its disk boundary with isolated temporary destinations and backup roots. Assert resulting files and recoverable backup contents, not implementation calls. Existing install and agent installation tests provide fixture and marker precedents.

Cover unedited, edited and legacy marked Skills; added nested user files and markers in backups; stale marked and unmarked Skills; recorded unchanged and edited agents; missing and invalid records; unrecorded agents; mixed destinations; dry run; retry; unique backups; and injected or reproducible backup failure before any deletion. Exercise hostile record keys, absolute paths and both separators, and symlinks in ancestors, ownership evidence and entries, including links to data outside the fixture. Cover refusal without the trust assertion, directory replacement and content edits during backup reporting, and preservation of added empty directories. Verify no linked target is modified. Test platform-dependent symlink creation where supported.

## Out of Scope

Changing `install`, `update`, Bootstrap installers, prompts, saved selections, destination discovery, migration, CLI help or package behavior. The cleanup operation is a foundation and does not itself perform automatic cleanup.

## Size estimate

The estimate counts the Spec and changed lines in the same way as Run size, excluding lockfiles and test fixtures. Files shared by both Tickets are counted once in the total.

| Work                                                         |        Files | Diff estimate |
| ------------------------------------------------------------ | -----------: | ------------: |
| Define: this Spec, glossary and planned ADR                  |            3 |          7 KB |
| Ticket 1: marked Skill cleanup, backups and tests            |            2 |          8 KB |
| Ticket 2: recorded agents, hostile-input tests and changelog | 2 additional |          9 KB |
| Total                                                        |            7 |         24 KB |

## Further Notes

The agreed later behavior is a multi-select install prompt with no initial selections, saved global and per-project choices shown for confirmation on later installs and Updates, and newly discovered destinations unselected. Discover `~/.claude`, `~/.claude-*` and the configured `CLAUDE_CONFIG_DIR`, and allow other explicit Claude paths. Unattended use requires explicit destinations or an explicit request to reuse saved choices; explicit destinations replace the entire saved selection. Migrate legacy owned installs. Deselecting removes proven Factory-owned files with edited data backed up. Copilot gets a dedicated Skills destination even alongside other targets. Cancelling Update happens before CLI or installed-file changes; a Bootstrap installer may already have installed the CLI before it asks. Project installs follow the same selection rules with separate project state.

The user accepted a three-Run split. This Run supplies cleanup; Run 2 covers install selection, persistence, discovery and migration, and must enforce the cleanup filesystem trust precondition before calling the internal operation; Run 3 integrates Update and Bootstrap interactions, including cancellation and unattended use. Follow-on scopes are [destination selection #567](https://github.com/TDSchreur/tds-factory/issues/567) and [Update and Bootstrap integration #568](https://github.com/TDSchreur/tds-factory/issues/568). [ADR 0037](../adr/0037-install-selections-own-destination-cleanup.md) records the decision; `install`, `update` and the Bootstrap installers now implement it.
