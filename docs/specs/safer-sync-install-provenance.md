# Safer sync and install, with provenance

## Problem Statement

`sync` and `install` replace a Skill folder by deleting it and copying again, so an I/O failure in between leaves a half-written or missing folder. Neither notices that someone edited a marked Skill locally; the edit is silently lost. `install` has no way to preview what it will do. Nothing records where each shipped Skill came from (upstream commit, transformations, licence), so the packed tarball cannot show its own provenance. Shipped Specs also still sit in `docs/specs/`.

## Solution

- Replace one marked Skill folder at a time: build the new folder in a staging directory next to the destination, then rename it into place. A failure leaves the old folder intact and removes the staging directory.
- Record a content hash in each marker file. Before replacing a marked folder, `sync` and `install` compare the folder with that hash and refuse (sync) or skip (install) when it was edited; `--force` replaces anyway.
- `tds-factory install --dry-run` prints what install would do and writes nothing.
- `sync` writes `skills/PROVENANCE.json`, one entry per shipped Skill, and the package ships it.
- Move shipped Specs into `docs/specs/archive/`.

## User stories

1. As a maintainer, I want a failed copy to leave the previous Skill folder untouched, so that an I/O error never leaves a half-written Skill.
2. As a maintainer, I want sync to refuse to overwrite a synced Skill I edited by hand, so that I do not lose edits silently.
3. As a user, I want install to skip an installed Skill I edited, and `--force` to replace it, so that my edits survive an update unless I say otherwise.
4. As a user, I want `install --dry-run` to list what would be installed, replaced, skipped or removed, so that I can check before changing my agent folders.
5. As a maintainer, I want an inventory per shipped Skill with source path, upstream URL and commit, transformations, licence and attribution, so that provenance is auditable.
6. As a maintainer, I want a test on the packed tarball that fails when a shipped Skill has no complete inventory entry, so that a release cannot lose provenance.
7. As a reader, I want shipped Specs in the archive, so that `docs/specs/` shows only work in flight.

## Implementation decisions

- `src/replace-dir.js` exports `replaceDir(dest, populate)`: `populate(stagingDir)` fills a sibling `.<name>.staging-<pid>` folder; an existing `dest` is renamed to a sibling `.<name>.old-<pid>`, staging is renamed to `dest`, then the old folder is removed. If the final rename fails the old folder is restored. Staging is always cleaned up.
- `src/tree-hash.js` exports `hashTree(dir)`: SHA-256 over sorted relative paths and file contents, excluding the marker file.
- Marker format: `sync` writes the source path on the first line and `sha256:<hex>` on the second; `install` writes `sha256:<hex>`. A marker without a hash (older install) counts as unmodified. A folder whose hash differs from its marker is "modified".
- Install computes the hash of what it copies, so a later install compares the destination against the previous install's hash.
- `--force` on `sync` is added; on `install` it already exists and now also covers modified folders.
- `--dry-run` applies to `install` only and covers skills, stale removal and Stage agent files.
- `skills/PROVENANCE.json`: `{ "skills": { <name>: { source, upstream, commit, transformations, license, attribution } } }`. `upstream`, `license` and `attribution` come from an optional `upstreams` map in `skills.manifest.json` keyed by the `vendor/<dir>` prefix; `commit` is `git rev-parse HEAD` of that submodule, `null` when unavailable. `transformations` lists `renamed from <x>` and `model-invocation flag removed` when they applied. Removed Skills drop out of the file. The `package.json` `files` list already includes `skills`.
- Tests: `replaceDir` and sync/install edit detection against fake repos and temp homes; dry-run leaves the filesystem untouched; the tarball test uses `npm pack --dry-run --json` like `test/license.test.js` and checks every marked Skill in `skills/` has a complete entry.

## Testing decisions

Test external behaviour only: folder contents after a simulated failure (populate throws), the refusal and skip messages, the files present after `--dry-run`, and the packed file list plus the entries in the committed `PROVENANCE.json`.

## Out of scope

Verifying provenance against the network, signing, changing how upstream Skills are rewritten, dry-run for `sync`.
