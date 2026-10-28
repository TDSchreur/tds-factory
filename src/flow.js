export const stages = ['define', 'prepare', 'build', 'check', 'finish'];

export const targets = {
  claude: { project: '.claude/skills', global: '.claude/skills' },
  codex: { project: '.agents/skills', global: '.agents/skills' },
  copilot: { project: '.github/skills', global: '.copilot/skills' },
};
