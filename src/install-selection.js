// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { isAgent, targets } from './flow.js';

/** @typedef {{ agent: import('./run-record.js').AgentName, configDir?: string }} Destination */
/** @param {string} input @param {string} cwd */
function absolute(input, cwd) {
  if (!input || input.includes('\0')) throw new Error('invalid destination path');
  return path.resolve(cwd, input);
}
/** @param {unknown} value @param {string} cwd @param {boolean} project @returns {Destination} */
function destination(value, cwd, project) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid destination');
  const item = /** @type {{ agent?: unknown, configDir?: unknown }} */ (value);
  if (!isAgent(item.agent)) throw new Error('unknown agent destination');
  if (item.configDir !== undefined && (item.agent !== 'claude' || project || typeof item.configDir !== 'string'))
    throw new Error('invalid Claude directory');
  return item.configDir === undefined
    ? { agent: item.agent }
    : { agent: item.agent, configDir: absolute(item.configDir, cwd) };
}
/** @param {Destination} item */
const key = (item) => `${item.agent}:${item.configDir ?? ''}`;
/** Reject links in every existing component before inspecting ownership evidence. @param {string} input */
function noLinks(input) {
  let current = input;
  while (true) {
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error(`symbolic link in destination: ${current}`);
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
/** @param {string} dir */
function ownedSkills(dir) {
  noLinks(dir);
  if (!fs.existsSync(dir)) return false;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const marker = fs.lstatSync(path.join(dir, entry.name, '.tds-factory'), { throwIfNoEntry: false });
    if (marker?.isFile()) return true;
  }
  return false;
}
/** @param {string} dir */
function ownedAgents(dir) {
  noLinks(dir);
  const record = path.join(dir, '.tds-factory-agents.json');
  const stat = fs.lstatSync(record, { throwIfNoEntry: false });
  if (!stat) return false;
  if (!stat.isFile()) throw new Error(`invalid agent record: ${record}`);
  const data = JSON.parse(fs.readFileSync(record, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`invalid agent record: ${record}`);
  const entries = Object.entries(data);
  for (const [name, hash] of entries) {
    if (
      !name ||
      name === '.' ||
      name === '..' ||
      /[\\/]/.test(name) ||
      typeof hash !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(hash)
    )
      throw new Error(`invalid agent record: ${record}`);
  }
  return entries.some(([name]) => fs.lstatSync(path.join(dir, name), { throwIfNoEntry: false })?.isFile() ?? false);
}
/**
 * @param {{home: string, cwd: string, env?: NodeJS.ProcessEnv, project?: boolean, custom?: string[], desired: Destination[], previous?: Destination[]}} options
 */
export function planSelection({ home, cwd, env = {}, project = false, custom = [], desired, previous = [] }) {
  home = absolute(home, cwd);
  const claude = project ? [] : [path.join(home, '.claude')];
  if (!project && env.CLAUDE_CONFIG_DIR) claude.push(absolute(env.CLAUDE_CONFIG_DIR, cwd));
  if (!project) {
    for (const entry of fs.readdirSync(home, { withFileTypes: true }))
      if (entry.isDirectory() && entry.name.startsWith('.claude-')) claude.push(path.join(home, entry.name));
    claude.push(...custom.map((value) => absolute(value, cwd)));
  } else if (custom.length) throw new Error('custom Claude directories are not supported for projects');
  /** @type {Destination[]} */
  const candidates = project ? [{ agent: 'claude' }] : claude.map((configDir) => ({ agent: 'claude', configDir }));
  candidates.push({ agent: 'codex' }, { agent: 'copilot' });
  const normalize = (/** @type {Destination[]} */ list) => {
    if (!Array.isArray(list)) throw new Error('selection must be a list');
    return [
      ...new Map(
        list
          .map((item) => destination(item, cwd, project))
          .map((item) =>
            !project && item.agent === 'claude' && !item.configDir
              ? { ...item, configDir: path.join(home, '.claude') }
              : item,
          )
          .map((item) => [key(item), item]),
      ).values(),
    ];
  };
  const selected = normalize(desired);
  const prior = normalize(previous);
  const all = normalize([...candidates, ...selected, ...prior]);
  const discovered = all.map((item) => {
    const root = project ? cwd : home;
    const skillDir =
      item.agent === 'claude' && item.configDir
        ? path.join(item.configDir, 'skills')
        : path.join(root, project ? targets[item.agent].project : targets[item.agent].global);
    const agentDir =
      item.agent === 'claude' && item.configDir
        ? path.join(item.configDir, 'agents')
        : path.join(root, project ? targets[item.agent].projectAgents : targets[item.agent].agents);
    const skills = ownedSkills(skillDir);
    const agents = ownedAgents(agentDir);
    return { ...item, skillsDir: skillDir, agentsDir: agentDir, installed: skills || agents };
  });
  const locations = new Set();
  for (const item of discovered) {
    const location = process.platform === 'win32' ? item.skillsDir.toLowerCase() : item.skillsDir;
    if (locations.has(location)) throw new Error('conflicting destination skills paths');
    locations.add(location);
  }
  return {
    candidates: discovered,
    desired: selected,
    previous: prior,
    deselected: prior.filter((item) => !selected.some((x) => key(x) === key(item))),
  };
}
