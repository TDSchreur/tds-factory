# Capability matrix per Agent target

What the Factory can rely on from each Agent target. "Not verified" means the claim comes from the target's documented configuration and has not been checked against a live client.

| Concern | Claude | Codex | Copilot |
|---|---|---|---|
| Skill invocation | The model calls an installed Skill by name; `/factory` starts the Flow. Skills live in `~/.claude/skills` or `.claude/skills`. | The user or model calls a Skill by name. Skills live in `~/.agents/skills` or `.agents/skills`. Codex ignores the Claude-only `disable-model-invocation` frontmatter, so it may start `factory` on its own. | Copilot CLI reads the Claude and Codex Skill directories; its own are `~/.copilot/skills` and `.github/skills`. Other Copilot environments are not verified. |
| Stage agent dispatch | Named agent in `~/.claude/agents` when the client can dispatch to it; otherwise the coordinator does the Stage itself. | Named agent in `~/.codex/agents`, same fallback. | Named agent in `~/.copilot/agents` (`.github/agents` with `--project`), same fallback. |
| Review isolation | `factory-check` is limited to `tools: Read, Grep, Glob`: it cannot edit or run commands. | `factory-check` runs with `sandbox_mode = "read-only"`. Not verified: that the sandbox also blocks reads outside the worktree. | `factory-check` is limited to `tools: ["view", "grep", "glob"]`; `modelPolicy: required` asks the client to refuse a substitute model. Not verified live. |
| Resumability | Run state lives in `.factory/runs/<id>/run.json`, not in the chat. A new session resumes with `tds-factory run inspect` and `run repair`, and the Run's `interrupted` status. Evidence tied to an older head is stale and gets redone. | Same. | Same. |
| Reviewer unavailable | The Run goes to `verification-unavailable` with a `status_reason` naming the axis. The coordinator never reviews its own work and records no `pass`. | Same. | Same. |

The Check agents are given the diff and any command output by the coordinator, because they cannot run commands. Where the table says "Same", the Factory behaves identically and only the host's tool or sandbox setting differs.

The rule for an unavailable reviewer is in the Check section of [`skills/factory/SKILL.md`](../skills/factory/SKILL.md). The upstream steps the Factory overrides are listed in its `## Invoked Skills` section. [`test/capabilities.test.js`](../test/capabilities.test.js) checks the Review isolation row against the shipped Stage agent files.
