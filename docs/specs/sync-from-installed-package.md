## Problem Statement

A maintainer who types `tds-factory sync` in a checkout gets `error: ENOENT: no such file or directory, open '.../node_modules/tds-factory/skills.manifest.json'` when `tds-factory` on PATH is the globally installed package. The installed package ships `skills/` but not `skills.manifest.json` or `vendor/` (`package.json` `files`), and `sync` finds its manifest relative to the package, not the current directory. The error does not say that `sync` is a maintainer command, nor what to run instead.

## Solution

`sync` checks for `skills.manifest.json` before reading it. When it is missing, it fails with a message that names the path, says `sync` needs a repository checkout, and tells the user to run `node bin/tds-factory.js sync` from the checkout.

## User Stories

1. As a maintainer who runs the installed `tds-factory sync` by mistake, I want an error that says `sync` needs a checkout, so that I know the installed copy is the cause.
2. As a maintainer, I want the error to name the command to run instead, so that I can continue at once.
3. As a Factory developer, I want a regression test for a root without a manifest, so that the bare ENOENT does not return.
4. As a maintainer running `sync` in a checkout, I want no change in behaviour.

## Implementation Decisions

- The check sits at the top of `sync`, before the manifest is parsed. Other errors from reading or parsing the manifest stay as they are.
- `sync` keeps resolving its root from the package location. Using the current directory instead would let the installed binary write into any repository it is run in.
- No change to `package.json` `files`, `GLOSSARY.md` or the ADRs. ADR 0001 already says `install` reads only the committed `skills/`.

## Testing Decisions

- The seam is the `sync` interface with a temporary root, as in the existing sync tests. The test builds a root without a manifest and asserts the error mentions a checkout and `bin/tds-factory.js sync`, and not `ENOENT`. It fails on the current code.

## Out of Scope

- Making the installed package able to run `sync`.
- Running `sync` against the current directory.

## Further Notes

Reported as `tds-factory sync` in `~/repos/tds-factory` after a global install.
