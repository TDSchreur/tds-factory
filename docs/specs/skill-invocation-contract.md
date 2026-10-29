# Skill invocation contract, capability matrix and agent evaluation

## Problem Statement

The `factory` Skill tells the agent to Invoke `to-spec`, `to-tickets` and `implement-spec`, but those upstream Skills have defaults that contradict the Flow. `to-spec` publishes the Spec to the issue tracker and asks the user to confirm the test seams. `to-tickets` quizzes the user until they approve the breakdown. `implement-spec` creates its own integration branch and per-Ticket worktrees, runs implementer subagents, may open a draft PR and ends with a `code-review`. The Factory wants none of that: Define runs without sign-off, the Spec is a file in `docs/specs/`, Build is inline in the Run worktree with one commit per Ticket, Check owns the review and Finish owns the PR.

Today the Factory resolves this with scattered sentences in its own Stage text and relies on the model to prefer them. Nothing states the effective contract in one place, nothing tests it, and a Skill update can silently change it. The per-Agent-target behaviour (how Skills and Stage agents are invoked, whether review is really isolated and read-only, what happens when a Run is interrupted or an independent reviewer is not available) is not documented, so users cannot tell what a Check on their target guarantees. There is no way to see whether an agent actually follows the Flow: the only tests cover the Run store and the Skill text.

## Solution

1. Document, inside the `factory` Skill, the effective invocation contract for `to-spec`, `to-tickets` and `implement-spec`, and add a short Factory-specific adapter for each conflict. The adapter overrides only the conflicting steps by reference and does not copy the upstream Skill. The upstream copies in `skills/` stay untouched.
2. Test the contract without an agent: a drift check ties each adapter to the upstream sentence it overrides, so an upstream change that removes or adds a conflict fails `npm test`.
3. Publish a capability matrix per Agent target covering invocation, review isolation, resumability and what happens when an independent reviewer is unavailable. State the unavailable-reviewer rule in the `factory` Skill and test that the Stage agent files really carry the read-only restriction the matrix claims.
4. Add an optional agent evaluation suite, run on demand and not by `npm test`. It builds fixture repos, puts an offline `gh` on the agent's PATH, runs a real agent against a scenario, and grades the artifacts and the recorded attempted actions, never the prose.

## User Stories

1. As a Factory maintainer, I want the contract between the Factory and each Skill it invokes written in one place, so that I know what the Flow relies on.
2. As a Factory user, I want Define to finish without being asked to confirm test seams or approve a breakdown, so that the Run does not stall on questions the Factory already answered.
3. As a Factory user, I want the Spec to be a file in `docs/specs/` and not an issue, so that Build's `spec_link` check can find it.
4. As a Factory user, I want Build to work inline in the Run worktree with one commit per Ticket, so that no second branch, worktree or draft PR appears beside the Run branch.
5. As a Factory user, I want Build to skip the closing review of `implement-spec`, so that Check is the only reviewer and reviewers never wrote the code.
6. As a maintainer, I want a failing `npm test` when an upstream sync adds, removes or rewords a conflicting step, so that adapters never go stale unnoticed.
7. As a maintainer, I want adapters to be short and reference the upstream steps they override, so that upstream improvements still flow in.
8. As a Factory user on Claude, Codex or Copilot, I want a matrix of how each target invokes Skills and Stage agents, so that I know what to expect.
9. As a Factory user, I want to know per target whether the Check agents are restricted by real tool or sandbox limits, so that I can trust the review independence.
10. As a Factory user, I want to know per target what happens to a Run when the session ends, so that I know how to resume it.
11. As a Factory user, I want a Run to stop and tell me when an independent reviewer cannot be started, so that the author never reviews their own code and records a `pass`.
12. As a maintainer, I want the matrix cross-checked against the shipped Stage agent files, so that the document cannot claim a restriction the file does not have.
13. As a maintainer, I want to run an agent against fixture repos on demand, so that I can see whether a model follows the Flow.
14. As a maintainer, I want the suite to use fixture repos in temporary directories and a fake `gh`, so that a scenario can never write to GitHub.
15. As a maintainer, I want every attempted `gh` and `git push` call recorded, so that I can grade what the agent tried to do even though it was blocked.
16. As a maintainer, I want scenarios graded on `run.json`, files, commits and recorded actions, so that grading does not depend on how the agent phrased things.
17. As a maintainer, I want a scenario where the reviewer is missing, so that I can see no `pass` verdict is written without independent review.
18. As a maintainer, I want a scenario where Verify fails, so that I can see the Run does not proceed past a failing Verify result.
19. As a maintainer, I want a scenario where the head changes after review, so that I can see stale Evidence is not used to reach Finish.
20. As a maintainer, I want a scenario where the user stops the Run, so that I can see the status become `abandoned` and nothing is pushed.
21. As a maintainer, I want a scenario where the session restarts after the PR exists, so that I can see no second PR is opened and the Run is completed.
22. As a maintainer, I want a scenario where the Spec is missing, so that I can see Build does not start.
23. As a maintainer, I want a scenario where an upstream Skill asks for an approval the Factory already resolved, so that I can see the agent does not stop to ask.
24. As a maintainer, I want the evaluation to be skipped by `npm test` and CI, so that the normal suite stays fast, offline and deterministic.
25. As a maintainer, I want the grading code itself tested offline, so that a broken grader does not report false passes.

## Implementation Decisions

- The adapter and contract live in a new `## Invoked Skills` section of the `factory` Skill. `skills/` copies of upstream Skills are not edited, because `sync` overwrites them (ADR 0001).
- The contract, stated per Skill:
  - `to-spec`: Define writes the Spec as a Markdown file in `docs/specs/` using the upstream template, does not publish it to the issue tracker, applies no triage label to it and does not ask for seam confirmation; the Factory chooses the seams. Upstream step 3's publishing and label sentence and step 2's confirmation sentence are overridden.
  - `to-tickets`: the breakdown is published without the quiz step; the tracker comes from `docs/agents/issue-tracker.md`. Upstream step 4 is overridden. A missing tracker label is still asked about, as the Flow already says.
  - `implement-spec`: Build works inline, on the Run worktree's branch, in dependency order, with no implementer, merger or exploration subagents, no extra integration branch or Ticket worktrees, no draft PR, and no closing `code-review`. One commit per Ticket. Upstream steps 2 to 7 and 9 are overridden; the Ticket resolution of step 8 is left to Finish through `Closes #N`.
- The adapter says that when an invoked Skill asks for an approval, confirmation or review the Factory section already resolved, the agent follows the Factory and does not ask the user.
- Each adapter line names the upstream step it overrides, in the form of a short quoted fragment, so the drift check can find it.
- Capability matrix: a new `docs/capabilities.md`, one table per concern with a column per Agent target (Claude, Codex, Copilot): Skill invocation, Stage agent dispatch, review isolation (the real restriction: Claude `tools: Read, Grep, Glob`, Codex `sandbox_mode = "read-only"`, Copilot `tools: ["view", "grep", "glob"]`), resumability (`tds-factory run inspect` and `run repair`, `interrupted` status, the head-tied Evidence) and behaviour when the independent reviewer is unavailable. Facts that cannot be verified offline are marked as unverified rather than asserted.
- Reviewer unavailable: when the client cannot start a fresh read-only reviewer for an axis, the Factory does not review the work itself and does not record `pass`. It sets the Run to `verification-unavailable` with a `status_reason` naming the axis and tells the user. This follows the existing rule that a Check agent may not be the author. The rule is added to the Check text of the `factory` Skill and to the matrix.
- Real tool restrictions: the Stage agent files already carry them; the matrix is checked against those files by a test and nothing is loosened.
- The evaluation suite lives in `eval/`, outside `test/`, with its own `npm run eval` script. It has four parts: fixture repo builders (a git repo with an origin, the conventions files, a `docs/agents` setup and a trivial project with a verify command), an offline `gh` shim placed first on the agent's PATH that records every invocation to a JSON-lines action log and answers read calls from canned data, a pre-push guard so a `git push` only reaches a local bare origin, and graders.
- The runner launches a configurable agent command per Agent target (default commands for Claude, Codex and Copilot, overridable by environment variable), with a scenario prompt, in the fixture repo with the shim environment, with a time limit, and then grades. Scenarios that need the user to answer are driven by a scripted answer in the prompt.
- Each scenario is a module with `setup(fixture)`, `prompt`, and `grade(artifacts)` returning named checks. Artifacts are `run.json`, the Run folder files, `git log` and status of the Run worktree, the files under `docs/specs/`, and the action log. A check reads these and never reads the agent's final text.
- Scenarios: reviewer missing (the reviewer agent files are removed from the fixture target; expect no `pass` verdict on any axis and `verification-unavailable`), Verify fails (the fixture verify command fails; expect a failing `verify` result, no transition to finish, no `pr`), head changes after review (the scenario commits after the verdicts; expect `run transition --to finish` is refused or the agent re-reviews, and no PR open attempt on stale Evidence), user stops a Run (a stop instruction mid-Run; expect `abandoned`, no push, no PR create), restart after PR creation (the fixture has a Run in Finish with a branch pushed and a recorded PR; expect no second `gh pr create`, the Run completed), Spec missing (a Run at Define with Tickets but no Spec file; expect Build not started and `stage` still `define`), upstream Skill approval already resolved (a fixture whose prompt would elicit the seam and breakdown questions; expect no waiting status caused by seams or breakdown, a Spec file in `docs/specs/`, and no spec issue in the action log).
- The offline `gh` never performs a write: write commands are logged as attempted actions and succeed with a canned response, so graders can assert both what was attempted and what would have been sent.
- The glossary gets **Invocation contract** (what the Factory relies on from an invoked Skill) and **Capability matrix**; an ADR records that adapters live in the `factory` Skill, not in the upstream copies.

## Testing Decisions

- A good test checks behaviour reachable from outside: the text and files a user or agent gets from the installed Skill, the installed agent files, the recorded Run state and the recorded actions. It does not check the prose of an agent's reply.
- `npm test` gets the drift check for the invocation contract, the check that the matrix matches the Stage agent files and names every Agent target and concern, the check for the reviewer-unavailable rule, and offline tests of the eval graders and `gh` shim with synthetic artifacts. These extend `test/skills.test.js` and add one new test file; prior art is the Skill-text assertions in `test/skills.test.js` and the Run command tests in `test/run-cli.test.js`.
- The scenarios themselves run only through `npm run eval` and are the behavioural test of the contract. They are not in `npm test` or CI. A live agent run is not performed in this repo's CI, and the final report says which scenarios were run against which agent, and which were not.
- Where a scenario run demonstrates the agent ignores an adapter, the adapter is tightened; no adapter is added for a conflict that is not shown by the drift check or a scenario.

## Out of Scope

- Editing upstream Skill copies in `skills/` or the `vendor/` submodules.
- Changing the Run store, its commands or the `run.json` schema.
- Running the evaluation in CI, scoring models against each other or guaranteeing results across model versions.
- Verifying live that a client honours a read-only tool or sandbox setting.
- Contract adapters for Skills other than `to-spec`, `to-tickets` and `implement-spec`.

## Further Notes

- The existing test that checks the exact set of Skills the Factory invokes keys on the word Invoke followed by a backticked name. The new section must refer to Skills without that phrasing.
- The eval harness needs a real agent CLI on PATH. When none is configured, `npm run eval` exits with a clear message and runs nothing.
