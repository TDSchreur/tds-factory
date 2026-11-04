# Build repeats changed tests; the sweep ignores diff.mnemonicprefix

Two changes in one Run, by the user's decision. Both come from the Runs of 4 November 2026: a flaky browser test reached CI because Build never repeated it ([#560](https://github.com/TDSchreur/tds-factory/issues/560)), and four sweep tests fail on a machine whose global git config sets `diff.mnemonicprefix`.

## Problem Statement

1. Build runs the Verify command once. A test that fails one run in twenty, or only under load, passes Build and Check and fails in CI. The `reliable-tests` guide has a repeat step, but nothing in the Exit checklist asks for it, and nothing asks Build to see a new test fail before it passes. Build agents also start test runs in the background and kill them with `pkill`, which leaves processes behind and can kill the agent's own shell.
2. `tds-factory run sweep` and `run size` call `git diff` with a fixed flag list that leaves the header prefixes to the user's git config. With `diff.mnemonicprefix=true` git prints `i/` and `w/` instead of `a/` and `b/`, the parser finds no file names, and four tests in `test/run-sweep.test.js` fail on plain develop.

## Solution

1. The Exit checklist gets an eighth step, **Repeat changed tests**, between Hostile input and Self-check. For every changed test file and every changed test helper, Build runs the repeat step of the project's reliable-tests guide: 30 runs plain, 30 under load and 30 with `--test-concurrency=1`. A new test must be seen failing on the code from before the change, and the failing output goes in `build.md`. Build agents never use `run_in_background` or `pkill` for test runs: they run in the foreground with a finite timeout, and load comes from foreground commands that wait for their children. The three Build agent files, the Build paragraph of the `factory` Skill, the canonical Exit checklist spec and the glossary say the same.
2. The flag list of the diff calls in `src/run-sweep.js` and `src/run-size.js` gets `--src-prefix=a/ --dst-prefix=b/`, so the prefixes no longer depend on the user's config. A regression test sets `diff.mnemonicprefix` in a test repository.

## User Stories

1. As a maintainer, I want Build to repeat every changed test file 30 times plain, under load and with `--test-concurrency=1`, so that a flaky test is found before CI.
2. As a maintainer, I want Build to see a new test fail on the pre-change code, so that a test that cannot fail is found.
3. As a maintainer, I want the failing and repeat results in `build.md`, so that Check and the PR can cite them.
4. As a maintainer, I want Build agents to run tests in the foreground and never use `run_in_background` or `pkill`, so that no test process is left behind and no agent kills its own shell.
5. As a maintainer, I want the three Build agent files, the Skill, the canonical spec and the glossary to name the same eight steps, so that no target follows an older list.
6. As a user with `diff.mnemonicprefix` or `diff.noprefix` in my git config, I want `run sweep` and `run size` to give the same answer as for anyone else, so that the unit tests pass on my machine.

## Implementation Decisions

- The step sits in `skills/factory/references/exit-checklist.md` and is canonical there; the Build paragraph of `skills/factory/SKILL.md` lists it by name.
- A project without a reliable-tests guide uses the same counts (30 plain, 30 under load, 30 with `--test-concurrency=1`). A change without a test file skips the step.
- Under load, without `pkill` or background jobs: one foreground command starts the load as children of a shell and the repeat loop, waits for both, and has a finite timeout (for example `timeout 300`). The load stops by itself.
- The pre-change code for the red run is a temporary `git worktree` at `base_sha` with the new test copied in, or the test written first and run before the fix (the `tdd` order).
- The sweep fix touches only the two flag lists; `src/guides.js` and `src/project-reviews.js` read names only (`--name-only`, `-z`) and are unaffected.
- Size estimate: Ticket 1 about 12 files and 9 KB (checklist reference, Skill, three agents, two tests, canonical spec, glossary, changelog fragment, this Spec), Ticket 2 about 4 files and 3 KB (two sources, one test, changelog fragment), Define artifacts counted in the first row. Total about 16 files and 12 KB, over two thirds of the limit; the user accepted one Run.

## Testing Decisions

- `test/skills.test.js` asserts the eight step names in order; `test/agents-install.test.js` asserts the Build sentence on every target.
- `test/run-sweep.test.js` gets a test that sets `diff.mnemonicprefix` in the test repository and expects the same output as without it; it must fail before the change.
- Verify runs with the user's global git config; Ticket 2 makes that work.

## Out of Scope

Changing Check; a script that repeats changed browser tests; other git-config sensitivity outside the two flag lists.

## Further Notes

Documents: `docs/specs/build-exit-checklist.md` is the canonical spec; `GLOSSARY.md` entry **Exit checklist**.
