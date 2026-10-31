# Evaluate an agent against the Flow

`npm run eval` runs a real agent against fixture repos and grades what it left behind. It is on demand: `npm test` never runs it, and nothing runs it on a push or pull request. What each Agent target guarantees is in the [capability matrix](capabilities.md); the Flow being graded is in the [usage guide](usage.md).

```sh
npm run eval -- <claude|codex|copilot> [scenario...]
```

Set `EVAL_AGENT_CMD` to use other flags or another client; the scenario prompt is in `$EVAL_PROMPT`. `EVAL_TIMEOUT_MS` limits each scenario (default 20 minutes). Without an agent the script runs nothing and says so.

## What a scenario does

1. Builds a project in a temporary directory with a local bare `origin`, the setup docs Preflight needs and the Factory installed for the Agent target.
2. Puts an offline `gh` first on `PATH`. It never contacts GitHub: it logs every call, answers writes with a canned URL and answers reads from canned state, with built-in answers for `repo view` and `label list`. A pre-push hook logs every `git push` and rejects any remote other than the local origin.
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
| `follow-up` | Failed CI and unresolved thread scope produce the fourth shared Rework, clear Evidence and retain the existing PR |
| `spec-missing` | Run stays in Define, no Ticket done |
| `approval-resolved` | Spec is a file in `docs/specs/`, no issue holds the Spec, Tickets carry `ready-for-agent`, Run not waiting |

`npm test` covers the shim, the runner and the graders with scripted stand-ins for the agent (`test/eval-harness.test.js`), so a broken grader cannot report false passes. It does not show that any model follows the Flow; only a run of the suite does. When a scenario shows an agent ignoring the `## Invoked Skills` section of the `factory` Skill, tighten that section.

## Run so far

Claude is the only Agent target that has been run live. Codex and Copilot have not been run; only the shim, the runner and the graders were exercised for them, with scripted stand-ins.

Baseline on 2026-10-31 with Claude Code 2.1.314 and `--model claude-haiku-5-5` (set through `EVAL_AGENT_CMD`), with `EVAL_TIMEOUT_MS=300000`. The first four scenarios ran one at a time. `head-changes`, `restart-after-pr` and the first, failing `approval-resolved` run shared one 4 min 26 s batch. Haiku is the cheapest model, so this baseline shows that the Flow and the graders work, not how the model you use day to day behaves.

| Scenario | Claude (Haiku 5.5) | Time |
|---|---|---|
| `spec-missing` | pass | 32 s |
| `user-stops` | pass | 12 s |
| `reviewer-missing` | pass | 44 s |
| `verify-fails` | pass | 1 min 43 s |
| `head-changes` | pass | batch of 4 min 26 s with the next two |
| `restart-after-pr` | pass | same batch |
| `approval-resolved` | pass after a fix, see below | 1 min 11 s |

The first `approval-resolved` run failed two checks, and the agent was not at fault in either:

- The grader required the Spec in `git diff`, but Define leaves its files uncommitted until Build starts. The grader now looks at `docs/specs/` in the worktree.
- The offline `gh` answered `repo view` and `label list` with an empty list, so the agent saw no GitHub repository and wrote its Ticket as a local file. The shim now answers both for a fixture repository. `test/eval-harness.test.js` covers the new answers.

The `follow-up` scenario was added after this baseline and has not been run against a live agent. No baseline scenario showed the agent ignoring the `## Invoked Skills` section, so that section is unchanged. Run the suite again on your usual model before you rely on the Flow with it. There is no CI workflow for it, because the eval needs a Claude login and the project has no API key; run it locally.
