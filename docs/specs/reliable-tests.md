# Reliable tests: a guide, a Skill, a wait helper and a Windows repeat run

## Problem Statement

Some tests are flaky, mostly on Windows. The causes repeat: a fixed sleep stands in for "the work is done" (`dashboard-projects.test.js`, `dashboard-pr-status.test.js`, `run-events.test.js`, `update.test.js`, `browser-teardown.test.js`), a hand-rolled poll loop is copied per file (`dashboard-page-browser.test.js`), and files on Windows stay locked a moment after a process exits. Past fixes (#195, #406, #438) were one-offs and wrote nothing down, so the next test repeats the mistake. Nothing in `tdd`, the guides or `docs/development.md` says how to write a test that does not depend on timing, and a PR gives no signal that a changed test is unstable on Windows.

## Solution

Write the lessons down where agents and people read them, give them one helper so the right thing is the easy thing, fix the known offenders, and make CI run changed tests more than once on Windows.

## User stories

1. As an agent writing a test, I want a short rule list that is loaded when I edit `test/`, so that I do not use a fixed sleep or a shared path.
2. As an agent or maintainer, I want a Skill I can invoke to diagnose or prevent a flaky test, so that I fix the cause instead of adding a retry.
3. As a test author, I want one `waitUntil` helper, so that I wait for a condition with a deadline instead of copying a poll loop.
4. As a maintainer, I want the known sleeps replaced, so that the Windows run stops failing at random.
5. As a maintainer, I want a PR that changes a test to run that test three times on Windows, so that an unstable test is caught before it merges.

## Implementation decisions

- **Guide.** `.github/instructions/reliable-tests.instructions.md` with `applyTo: 'test/**'`, linked from `AGENTS.md`, with its generated copy in `.claude/rules/` from `tds-factory rules` (ADR 0022). The rules:
  - no fixed sleep as synchronization; wait on an event or a condition with a deadline (`waitUntil`);
  - a negative assertion ("nothing happened") waits for a signal that proves the other side had its chance, never a bare delay; where a short delay is unavoidable, name why in a comment;
  - never rely on timestamp ordering without controlling the clock or waiting until the clock has advanced;
  - ask the OS for port 0 and give every test its own temp folder; never share a fixed path, port or file name;
  - on Windows a removed or renamed file can stay locked for a moment: clean up with `rmSync(..., { maxRetries, retryDelay })`;
  - build paths with `path.join` and never assume `\n` or `/` in output;
  - skip a platform-specific test with a reason, never silently;
  - fix the cause of a flaky test, never add a blind retry or raise a timeout without a reason.
- **Skill.** A new Factory-owned Skill `skills/reliable-tests/SKILL.md` (not a change to the synced `tdd` copy, which `tds-factory sync` would overwrite; ADR 0001). It covers diagnosing a flaky test (reproduce under load and with `--test-concurrency=1`, repeat runs, read the failure, classify the cause as timing, shared state, platform or ordering) and the fixes, and points at the guide for the rules. The Factory Exit checklist's self-check step names the guide, without a new `Invoke`, so the Skill list the tests pin does not change.
- **Helper.** `test/wait-until.js` exports `waitUntil(condition, { timeoutMs = 5000, intervalMs = 20, message })`, which polls a sync or async condition, resolves with its truthy value, and rejects with `message` on the deadline. It is typed in JSDoc and checked by `test/tsconfig.json`. It has its own unit test.
- **Migration.** Replace the listed sleeps: `waitForCalls` and the browser-teardown loop use `waitUntil`; the `run-events` waits use a wait until `Date.now()` advances; the `dashboard-pr-status` `settle` and the two `dashboard-projects` waits wait for an observable state or, for a negative assertion, for a signal that the other request completed; the `update.test.js` wait waits for the abort entries. `browser-teardown.test.js` keeps one short delay only where a comment explains why.
- **Docs.** A "Flaky tests" section in `docs/development.md`: how to reproduce, the rules in one paragraph with a link to the guide, and the Windows repeat run.
- **CI.** In the Windows job, on pull requests only, find the test files the PR changed against the base (`git diff --name-only` of `test/*.test.js`, minus `*-browser.test.js`) and run each three times with `node --test --test-isolation=process` through a small `scripts/repeat-changed-tests.js`. A PR that changes no unit test file skips the step. The job is added to nothing new, so `ci-ok` is unchanged.
- **Changelog.** A fragment `changelog.d/reliable-tests.md`.
- No production code changes.

## Testing decisions

- `waitUntil` is tested at its own seam: resolves with the value, polls until truthy, rejects with the message on the deadline, accepts an async condition.
- `scripts/repeat-changed-tests.js` is tested at its seam: given a list of changed paths it picks unit test files only, and with none it exits 0 without running anything.
- The guide, its link in `AGENTS.md` and its `.claude/rules` copy are covered by the existing guide tests.
- The migration is verified by running each changed test file 20 times in a row under CPU load.
- `npm run test:unit` after each Ticket; `npm test`, `npm run check` and `actionlint` before Check.

## Out of scope

- Making the browser tests run on Windows.
- Changing the shards or adding retries to CI.
- Editing the synced `tdd` Skill.

## Documents

`docs/development.md` (Working on Windows, Flaky tests), `AGENTS.md` (guide list), `docs/specs/windows-friendly.md` and `docs/specs/fix-flaky-delete-all-test.md` (history; unchanged), `skills/factory/references/exit-checklist.md`, `.github/workflows/ci.yml`, `test/tsconfig.json` coverage and `changelog.d/reliable-tests.md`.
