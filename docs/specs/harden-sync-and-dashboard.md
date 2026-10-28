# Harden sync and the Dashboard

## Problem Statement

The last Run's Check passed, but the reviewers left open points. `sync` joins values from the manifest into file paths without checking them, follows symlinks inside a vendored skill when it rewrites Markdown, and builds its rename pattern from an unescaped name. Its rename logic is tested only by reading the committed `skills/` folder, never by running `sync`, so a broken `sync` could still pass. The Dashboard answers any request that reaches its port, whatever the `Host` header says, so a web page in my browser could read my local path and Run records through DNS rebinding. None of this is exploitable today, but each point is cheap to close and none has a test.

## Solution

Make `sync` strict and testable. It validates every manifest entry before writing anything, refuses a skill folder that contains a symlink, escapes the name it puts in the rename pattern, and takes optional roots so a test can run it over a small fake vendor folder. The Dashboard rejects any request whose `Host` is not its own loopback address. Each change is covered by a test at an existing seam.

## User Stories

1. As a maintainer, I want `sync` to refuse a manifest entry whose shipped name is not lowercase letters, digits and hyphens, so that a bad `as` value can never become a path
2. As a maintainer, I want `sync` to refuse a source path that leaves the repository, so that a manifest entry can't read from outside it
3. As a maintainer, I want `sync` to refuse a destination that leaves the shipped skills folder, so that a manifest entry can't delete or write outside it
4. As a maintainer, I want the error to name the offending manifest entry, so that I can fix it at once
5. As a maintainer, I want `sync` to validate every entry before it writes any, so that a bad entry never leaves the skills folder half updated
6. As a maintainer, I want `sync` to fail loudly when a skill folder it is about to ship contains a symlink, so that a hostile or careless upstream commit can't make `sync` rewrite files outside the skill
7. As a maintainer, I want the symlink error to name the skill and the link, so that I know what to remove
8. As a maintainer, I want shipped skills to be plain files, so that what I review in a diff is what gets installed
9. As a maintainer, I want the skill name escaped before it goes into the rename pattern, so that a name with special characters can't change what is replaced
10. As a maintainer, I want the per-file rewrite in its own small helper, so that `sync` reads as validate, copy, rewrite, mark
11. As a maintainer, I want `sync` to take optional roots that default to the repository's, so that nothing changes for the CLI
12. As a maintainer, I want a test that runs `sync` over a temp vendor folder and manifest, so that the real code path is tested and not only its committed output
13. As a maintainer, I want that test to cover the rename, with the name set in the frontmatter and mentions of the old name rewritten in every Markdown file, so that the Claude name collision stays fixed
14. As a maintainer, I want that test to cover that a longer name sharing the old name as a prefix is left alone, so that the rewrite boundary holds
15. As a maintainer, I want that test to cover that skills the Flow invokes lose the model-invocation flag, so that the original bug can't return unnoticed
16. As a maintainer, I want that test to cover each validation error and the symlink refusal, with nothing written, so that the failure cases are locked down
17. As a maintainer, I want the old test that only reads the committed tree for the rename removed, so that the suite doesn't claim coverage it doesn't have
18. As a developer using the Dashboard, I want it to answer 403 to a request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>`, so that a web page can't read my local data through DNS rebinding
19. As a developer, I want the Host check on every route, including the page, the run list, the info route and the file route, so that no route is left open
20. As a developer, I want requests to `127.0.0.1` and `localhost` to keep working, so that I can open the Dashboard either way
21. As a developer, I want the Dashboard to stay read-only and loopback-only, so that the check adds to the existing rules and replaces none of them
22. As a developer reading the Dashboard spec, I want the Host rule listed, so that the spec matches the server
23. As a developer reading the README, I want the sync rules mentioned briefly, so that a maintainer knows why a manifest entry can be refused
24. As a developer, I want the observation-log items kept out of this Run, so that this round stays small

## Implementation Decisions

- **Manifest validation:** `sync` validates every entry before it writes any. The shipped name must be lowercase letters, digits and hyphens. The source, resolved against the repository root, must stay inside it, and the destination, resolved against the shipped skills folder, must stay inside that folder. Any failure throws an error that names the entry.
- **Further refusals:** found by Check and kept: a source that is the repository root or sits inside the skills folder, a source that is or sits under a symlink, two entries that ship under the same name, and a malformed entry (each named in the error). A skill's Markdown walk rewrites only real files, so a directory named like a Markdown file cannot break a run.
- **Symlinks:** before copying, `sync` walks the source skill folder and throws if it finds a symlink, naming the skill and the link. Nothing is written for that skill.
- **Rename pattern:** the old name is escaped before it goes into the rename pattern. The boundary rule stays: the old name is replaced only when the next character is not a word character or a hyphen.
- **Helper:** the rewrite of one Markdown file moves out of `sync` into a small function. It sets the frontmatter name for `SKILL.md`, rewrites old-name mentions, and strips the model-invocation flag for the skills the Flow invokes.
- **Injectable roots:** `sync` accepts the repository root and the shipped skills folder as optional arguments. The defaults are today's, so the CLI and the install flow are unchanged. The skills the Flow invokes are read from the shipped `factory` Skill under the given roots.
- **Host check:** the Dashboard server compares the `Host` header with its own loopback address and port, in both the `127.0.0.1` and the `localhost` form. Anything else gets 403 before routing, on every route. The existing read-only rule and loopback binding stay.
- **Docs:** the Dashboard spec lists the Host rule, and the README mentions that `sync` refuses invalid manifest entries and symlinks.
- **Glossary and ADR:** no new term and no ADR; each change is easy to reverse.

## Testing Decisions

- **What makes a good test:** only external behavior at the two seams below. Tests do not call the rewrite helper directly and do not reuse the code's rename pattern.
- **Seam 1, the Dashboard server's HTTP interface:** the existing server tests. The raw-request helper sends a `Host` header. A foreign `Host` gets 403 on every route; `127.0.0.1:<port>` and `localhost:<port>` still get the normal answers. Non-GET methods are still rejected.
- **Seam 2, the `sync` interface:** a test builds a small fake vendor folder, manifest and `factory` Skill in a temp directory and runs `sync` over it with those roots. It checks the rename (name in the frontmatter, old mentions rewritten in every Markdown file, a longer name left alone), the flag removal for an invoked skill, each validation error and the symlink refusal, and that a failing run writes nothing.
- **Removed:** the test that checks the rename only by reading the committed `skills/` folder. The remaining committed-tree tests stay, because they check the real shipped skills.
- **Not automatically tested:** nothing new. The page is unchanged.
- **Prior art:** the existing Dashboard server tests and skills tests, both on `node:test`. No new dependency.

## Out of Scope

- The observation-log items: factory prose, the Run record, Check wording and the reviewer severity bar.
- Hardening `install`, and the existing handling of a symlinked destination there.
- Any change to what the Dashboard shows or to its routes.
- Changing how `code-review` or `security-scan` work upstream.
- Authentication or access beyond loopback.

## Further Notes

- These points came from the Check of the previous Run: two LOW findings and one INFO from Security, the unescaped rename pattern and the test coverage from Standards and Spec.
- After the change, running `tds-factory install` is not needed for the code, because `sync` and the Dashboard run from the repository. The `README` change has no installed copy.
