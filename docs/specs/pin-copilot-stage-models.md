## Problem Statement

On Copilot CLI, the Factory dispatches Stage agents as subagents. The shipped `factory-define` and `factory-check` agents request `claude-sonnet-4.6`. A plan that does not list that model gets "Model 'claude-sonnet-4.6' is not available" and the Stage cannot run. The README and the capability matrix say an unavailable model is replaced by the session model, which is only true when an agent is started directly.

## Solution

The Copilot `factory-define` and `factory-check` agents request `claude-sonnet-5.5`, a model the affected plan lists. The README and the capability matrix say what Copilot does in each case: a directly started agent falls back to the session model with a warning, a dispatched subagent is refused. They state which Copilot CLI version this was checked against.

## User Stories

1. As a Copilot user, I want the Define Stage agent to dispatch, so that the Flow can start.
2. As a Copilot user, I want the Check Stage agents to dispatch, so that a Run can reach a verdict.
3. As a reader of the README, I want to know that a model my plan lacks stops a dispatched agent, so that I edit `model:` instead of waiting for a fallback.
4. As a maintainer, I want the docs to state what was verified and against which Copilot CLI version, so that nobody reads an unchecked claim as a guarantee.
5. As a Claude or Codex user, I want nothing to change for me.

## Implementation Decisions

- Only the two Copilot agent files change their `model:` line. Build keeps `gpt-5.3-codex` and Finish keeps `claude-haiku-4.5`; both are on the failing plan's list.
- The README model table shows `claude-sonnet-5.5` for Define and Check on Copilot.
- The README and the capability matrix replace the claim that a missing model is replaced by the session model. They say it holds when the agent is started directly (with a warning) and not when it is dispatched as a subagent, and that the defaults were checked by dispatching against Copilot CLI 1.0.105 with one plan's model list.
- No `modelPolicy` is added; no other Stage, agent or target changes.
- No ADR: easy to undo, no lasting trade-off.

## Testing Decisions

- No automated regression test. Whether a model is available depends on the plan and the live Copilot service. A test against a hard-coded list would go stale and give false confidence, so none is added.
- The existing suite must still pass, including the agent install and capability tests.
- Verified by hand with the dispatch command against Copilot CLI 1.0.105: an agent requesting an unlisted model is refused, one requesting a listed model or none answers.

## Out of Scope

- Making the Factory choose models from the plan's live list.
- Changing Claude or Codex models or any effort setting.
- Re-pinning Build and Finish.

## Further Notes

Found while diagnosing a report that Check on Copilot failed with "Model 'claude-sonnet-4.6' is not available". Follows #175, which removed `modelPolicy` on the belief that fallback always applies.
