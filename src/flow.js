// @ts-check
import path from 'node:path';

/** @type {import('./run-record.js').Stage[]} */
export const stages = ['define', 'build', 'check', 'finish', 'follow-up'];
/** @param {unknown} value @returns {value is import('./run-record.js').Stage} */
export const isStage = (value) => stages.some((stage) => stage === value);
/** The position of a name in the Flow, or -1. @param {string} name */
export const stageIndex = (name) => stages.findIndex((stage) => stage === name);

/** @type {Record<import('./run-record.js').AgentName, { project: string, global: string, agents: string, projectAgents: string }>} */
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

/** The Agent targets, in the order the commands list them. @type {import('./run-record.js').AgentName[]} */
export const agentNames = ['claude', 'codex', 'copilot'];
/** @param {unknown} value @returns {value is import('./run-record.js').AgentName} */
export const isAgent = (value) => agentNames.some((name) => name === value);

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
 * @param {import('./run-record.js').AgentName} agent
 * @param {'global' | 'agents'} kind
 * @param {string} home
 * @param {NodeJS.ProcessEnv} [env]
 */
export function userDir(agent, kind, home, env = process.env) {
  if (agent === 'claude') return path.join(claudeHome(home, env), kind === 'global' ? 'skills' : 'agents');
  return path.join(home, targets[agent][kind]);
}
