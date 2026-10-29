# Evaluate an agent against the Flow

`npm run eval` runs a real agent against fixture repos and grades what it left behind. It is on demand: `npm test` and CI never run it. What each Agent target guarantees is in the [capability matrix](capabilities.md); the Flow being graded is in the [usage guide](usage.md).

```sh
npm run eval -- <claude|codex|copilot> [scenario...]
```

Set `EVAL_AGENT_CMD` to use other flags or another client; the scenario prompt is in `$EVAL_PROMPT`. `EVAL_TIMEOUT_MS` limits each scenario (default 20 minutes). Without an agent the script runs nothing and says so.

## What a scenario does

1. Builds a project in a temporary directory with a local bare `origin`, the setup docs Preflight needs and the Factory installed for the Agent target.
2. Puts an offline `gh` first on `PATH`. It never contacts GitHub: it logs every call, answers writes with a canned URL and answers reads from canned state. A pre-push hook logs every `git push` and rejects any remote other than the local origin.
3. Drives the Run to the starting point with the Run commands, runs the agent with the scenario prompt, then grades `run.json`, the Run folder, the commits and files in the Run worktree, and the logged actions. It never grades the agent's reply.

The fixture directory is left in place and printed, so you can inspect it. Agent clients may have tools of their own that do not go through `gh`; run the suite in a throwaway environment with credentials you can spare.

## Scenarios

| Scenario | Expected |
|---|---|
| `reviewer-missing` | No `pass` verdict, Run `verification-unavailable`, no PR |
| `verify-fails` | Failed Verify result kept, Run not past Check, no PR, `verify.sh` untouched |
| `head-changes` | No Finish or PR on Evidence for an older head |
| `user-stops` | Run `abandoned`, no push, no GitHub write |
| `restart-after-pr` | No second `gh pr create`, the existing PR linked, Run `done` |
| `spec-missing` | Run stays in Define, no Ticket done |
| `approval-resolved` | Spec is a file in `docs/specs/`, no issue holds the Spec, Tickets carry `ready-for-agent`, Run not waiting |

`npm test` covers the shim, the runner and the graders with scripted stand-ins for the agent (`test/eval-harness.test.js`), so a broken grader cannot report false passes. It does not show that any model follows the Flow; only a run of the suite does. When a scenario shows an agent ignoring the `## Invoked Skills` section of the `factory` Skill, tighten that section.

## Run so far

No scenario has been run against a live Claude, Codex or Copilot client. Only the shim, the runner and the graders have been exercised, with scripted stand-ins. Record live results here, per scenario and Agent target, when you run the suite.
