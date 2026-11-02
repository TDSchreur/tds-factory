// @ts-check
import path from 'node:path';

export const stages = ['define', 'build', 'check', 'finish', 'follow-up'];

export const targets = {
  claude: {
    project: '.claude/skills',
    global: '.claude/skills',
    agents: '.claude/agents',
    projectAgents: '.claude/agents',
  },
  codex: {
    project: '.agents/skills',
    global: '.agents/skills',
    agents: '.codex/agents',
    projectAgents: '.codex/agents',
  },
  copilot: {
    project: '.github/skills',
    global: '.copilot/skills',
    agents: '.copilot/agents',
    projectAgents: '.github/agents',
  },
};

// Claude Code reads its user-level folder from CLAUDE_CONFIG_DIR when that is set to a non-empty value, else ~/.claude.
/**
 * @param {string} home
 * @param {NodeJS.ProcessEnv} [env]
 */
export function claudeHome(home, env = process.env) {
  const configured = env.CLAUDE_CONFIG_DIR;
  return configured ? path.resolve(configured) : path.join(home, '.claude');
}

// The user-level folder of an agent's skills ('global') or agents ('agents'); only Claude's moves with CLAUDE_CONFIG_DIR.
/**
 * @param {'claude' | 'codex' | 'copilot'} agent
 * @param {'global' | 'agents'} kind
 * @param {string} home
 * @param {NodeJS.ProcessEnv} [env]
 */
export function userDir(agent, kind, home, env = process.env) {
  if (agent === 'claude') return path.join(claudeHome(home, env), kind === 'global' ? 'skills' : 'agents');
  return path.join(home, targets[agent][kind]);
}
