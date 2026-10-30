# Capability matrix per Agent target

What the Factory can rely on from each Agent target. "Not verified" means the claim comes from the target's documented configuration and has not been checked against a live client.

| Concern | Claude | Codex | Copilot |
|---|---|---|---|
| Skill invocation | The model calls an installed Skill by name; `/factory` starts the Flow, and the model can start it too. Skills live in `~/.claude/skills` or `.claude/skills`. | The user or model calls a Skill by name. Skills live in `~/.agents/skills` or `.agents/skills`. | Copilot CLI reads the Claude and Codex Skill directories; its own are `~/.copilot/skills` and `.github/skills`. Other Copilot environments are not verified. |
| Stage agent dispatch | Named agent in `~/.claude/agents` when the client can dispatch to it; otherwise the coordinator does the Stage itself. | Named agent in `~/.codex/agents`, same fallback. | Named agent in `~/.copilot/agents` (`.github/agents` with `--project`), same fallback. |
| Review isolation | `factory-check` is limited to `tools: Read, Grep, Glob`: it cannot edit or run commands. | `factory-check` runs with `sandbox_mode = "read-only"`. Not verified: that the sandbox also blocks reads outside the worktree. | `factory-check` is limited to `tools: ["view", "grep", "glob"]`. The Copilot agents do not set `modelPolicy`. Started directly with `--agent`, an agent whose model the plan lacks falls back to the session model with a warning, but dispatched as a subagent it is refused with "Model ... is not available". Verified against Copilot CLI 1.0.105 only. |
| Resumability | Run state lives in `.factory/runs/<id>/run.json`, not in the chat. A new session resumes with `tds-factory run inspect` and `run repair`, and the Run's `interrupted` status. Evidence tied to an older head is stale and gets redone. | Same. | Same. |
| Reviewer unavailable | The Run goes to `verification-unavailable` with a `status_reason` naming the axis. The coordinator never reviews its own work and records no `pass`. | Same. | Same. |

The Check agents are given the diff and any command output by the coordinator, because they cannot run commands. Where the table says "Same", the Factory behaves identically and only the host's tool or sandbox setting differs.

The rule for an unavailable reviewer is in the Check section of [`skills/factory/SKILL.md`](../skills/factory/SKILL.md). The upstream steps the Factory overrides are listed in its `## Invoked Skills` section. [`test/capabilities.test.js`](../test/capabilities.test.js) checks the Review isolation row against the shipped Stage agent files.

## Default models per Stage

`tds-factory install` writes four Stage agents per target (`factory-define`, `factory-build`, `factory-check`, `factory-finish`) next to the skills: `~/.claude/agents`, `~/.codex/agents` and `~/.copilot/agents` (`.github/agents` with `--project` for Copilot). `factory-define` does the Define Stage. The main agent stays the coordinator: it talks to you, owns the Run record and approvals, and runs the Check reviews as three or four independent read-only agents. Each cell is model and reasoning effort; "default" means the session setting applies and "not set" means Copilot has no effort setting.

| Stage | Claude | Codex | Copilot |
|---|---|---|---|
| Define | Sonnet, high | `gpt-6.1-sol`, medium | `claude-sonnet-5.5`, not set |
| Build | Sonnet, medium | `gpt-6.1-terra`, medium | `gpt-5.3-codex`, not set |
| Check | Opus, high | `gpt-6.1-sol`, high | `claude-sonnet-5.5`, not set |
| Finish | Haiku, low | `gpt-6-luna`, medium | `claude-haiku-4.5`, not set |

Edit the agent files to change a model. The Copilot agents set no `modelPolicy`, so a model your plan does not offer is replaced by the session model with a warning when you start the agent directly, but Copilot refuses to dispatch it as a subagent, which is how the Factory uses it. Check `/model` in Copilot CLI for the ids your plan offers and edit `model:` to match. Install updates agent files you have not edited and keeps ones you have; `--force` replaces those with the defaults too. Agent files from an install that predates this count as edited, so use `--force` once. Whether a model is available depends on your client, account and policy, and the client may substitute another or not report which one ran; the Factory reports such cases instead of assuming. The Copilot defaults were checked by dispatching against Copilot CLI 1.0.105 with one plan's model list, not against other Copilot environments or plans.

To see whether an agent follows the Flow, run the on-demand [agent evaluation](evaluation.md).
