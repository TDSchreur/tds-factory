---
name: reliable-tests
description: 'Diagnose, fix and prevent flaky tests, mostly timing, shared state and Windows differences. Use when a test passes and fails at random, fails only on one platform or in CI, when writing a test that waits, spawns a process, uses a port, a temp folder or timestamps, or when asked to make tests more reliable.'
---

# Reliable tests

A flaky test fails without a change in the code. Treat it as a bug in the test (or in the code's missing signal), never as bad luck. The rules live in the guide `.github/instructions/reliable-tests.instructions.md`; read it first. This Skill is the procedure.

## Diagnose

1. **Reproduce.** Run the file in a loop (`for i in $(seq 30); do node --test test/<file>.test.js || break; done`), then again under CPU load (run several copies at once) and with `--test-concurrency=1`. If the failure only shows on Windows, run the Windows shard in CI, or the same loop in PowerShell 7 and Git for Windows. No reproduction yet is no fix yet: keep trying before you change code.
2. **Read the failure.** Take the first assertion that failed, not the last. Note the time it took and what ran before it.
3. **Classify the cause.** One of:
   - **Timing**: a fixed sleep, a short time budget, an assertion on elapsed time or timestamp order.
   - **Shared state**: a fixed port, path, file name, environment variable, or a leftover from another test.
   - **Platform**: path separators, line endings, locked files, signals, symlinks, slow process start.
   - **Ordering**: the test needs an earlier test, or two tests race on a file.
4. **State the cause** in one sentence before fixing it.

## Fix

- Timing: replace the sleep with `waitUntil` (`test/wait-until.js`) on a condition or an event. For "nothing happened", wait for a signal that proves the other side had its chance.
- Shared state: a port 0, a temp folder per test (`test/git-repo.js`), `t.after` cleanup.
- Platform: `path.join`, `rmSync` with `maxRetries`, a skip with a reason where the platform cannot do it.
- Ordering: make the test build its own setup.
- Do not add a retry, `skip` the test or raise a timeout to make it green, unless you can say why the original budget was wrong.

## Verify

Run the loop from step 1 again: 30 passes in a row and the Verify command. Name the cause and the fix in the commit message.
