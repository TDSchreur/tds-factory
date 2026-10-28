export const stages = ['define', 'prepare', 'build', 'check', 'finish'];

export const targets = {
  claude: { project: '.claude/skills', global: '.claude/skills', agents: '.claude/agents', projectAgents: '.claude/agents' },
  codex: { project: '.agents/skills', global: '.agents/skills', agents: '.codex/agents', projectAgents: '.codex/agents' },
  copilot: { project: '.github/skills', global: '.copilot/skills', agents: '.copilot/agents', projectAgents: '.github/agents' },
};
