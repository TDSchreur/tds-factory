// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { isAgent, targets } from './flow.js';
import { FactoryError } from './errors.js';
import { printable } from './printable.js';

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
  if (Object.keys(item).some((name) => name !== 'agent' && name !== 'configDir'))
    throw new Error('invalid destination field');
  if (!isAgent(item.agent)) throw new Error('unknown agent destination');
  if (item.configDir !== undefined && (item.agent !== 'claude' || project || typeof item.configDir !== 'string'))
    throw new Error('invalid Claude directory');
  return item.configDir === undefined
    ? { agent: item.agent }
    : { agent: item.agent, configDir: canonical(absolute(item.configDir, cwd)) };
}
/** @param {Destination} item */
const key = (item) =>
  `${item.agent}:${process.platform === 'win32' ? (item.configDir ?? '').toLowerCase() : (item.configDir ?? '')}`;
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
// Resolve aliases in existing ancestors while retaining a missing suffix.
/** @param {string} dir */
function canonical(dir) {
  noLinks(dir);
  const missing = [];
  let current = dir;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error('cannot resolve destination path');
    missing.unshift(path.basename(current));
    current = parent;
  }
  return path.join(fs.realpathSync.native(current), ...missing);
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
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(fs.readFileSync(record, 'utf8'));
  } catch (cause) {
    throw new FactoryError(
      `cannot read the install record ${record}: ${printable(String(cause))} (remove the file to install again)`,
      {
        code: 'install-record-unreadable',
        cause,
      },
    );
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`invalid agent record: ${record}`);
  const entries = Object.entries(data);
  for (const [name, hash] of entries) {
    if (
      !name ||
      name === '.' ||
      name === '..' ||
      name === '.tds-factory-agents.json' ||
      Buffer.byteLength(name) > 255 ||
      /[<>:"/\\|?*\x00-\x1f\x7f]/.test(name) ||
      /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ||
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
  home = canonical(absolute(home, cwd));
  if (project) noLinks(absolute(cwd, cwd));
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
              ? {
                  ...item,
                  configDir: canonical(
                    env.CLAUDE_CONFIG_DIR ? absolute(env.CLAUDE_CONFIG_DIR, cwd) : path.join(home, '.claude'),
                  ),
                }
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
  /** @type {Set<string>} */
  const locations = new Set();
  for (const item of discovered) {
    for (const dir of [item.skillsDir, item.agentsDir]) {
      const location = process.platform === 'win32' ? dir.toLowerCase() : dir;
      for (const existingPath of locations) {
        const forward = path.relative(existingPath, location);
        const backward = path.relative(location, existingPath);
        if (
          !forward ||
          (!forward.startsWith(`..${path.sep}`) && forward !== '..' && !path.isAbsolute(forward)) ||
          (!backward.startsWith(`..${path.sep}`) && backward !== '..' && !path.isAbsolute(backward))
        )
          throw new Error('conflicting destination paths');
      }
      locations.add(location);
    }
  }
  const unavailable = prior.filter(
    (item) => item.agent === 'claude' && item.configDir && !fs.existsSync(item.configDir),
  );
  return {
    candidates: discovered,
    desired: selected,
    previous: prior,
    deselected: prior.filter((item) => !unavailable.includes(item) && !selected.some((x) => key(x) === key(item))),
    unavailable,
  };
}

/** @typedef {{file: string, home: string, cwd: string, project?: boolean, env?: NodeJS.ProcessEnv}} RecordOptions */
/** @param {RecordOptions} options */
export function readSelection({ file, home, cwd, project = false, env = {} }) {
  file = absolute(file, cwd);
  noLinks(path.dirname(file));
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (!stat.isFile()) throw new Error(`invalid selection record: ${file}`);
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (
      !record ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      record.version !== 1 ||
      Object.keys(record).sort().join(',') !== 'selected,version' ||
      !Array.isArray(record.selected)
    )
      throw new Error('invalid schema');
    for (const item of record.selected) {
      if (!project && item?.agent === 'claude' && typeof item.configDir !== 'string')
        throw new Error('missing Claude path in record');
      if (item?.configDir !== undefined && (typeof item.configDir !== 'string' || !path.isAbsolute(item.configDir)))
        throw new Error('relative Claude path in record');
    }
    const desired = planSelection({ home, cwd, project, env, desired: record.selected }).desired;
    if (desired.length !== record.selected.length) throw new Error('duplicate destination');
    return desired;
  } catch (cause) {
    throw new Error(`invalid selection record: ${file}`, { cause });
  }
}

/** @param {RecordOptions & {selected: Destination[], dryRun?: boolean, trustedPaths?: boolean}} options */
export function saveSelection({
  file,
  home,
  cwd,
  project = false,
  env = {},
  selected,
  dryRun = false,
  trustedPaths = false,
}) {
  if (!dryRun && trustedPaths !== true) throw new Error('selection record writes require trusted filesystem paths');
  file = absolute(file, cwd);
  const previous = readSelection({ file, home, cwd, project, env }) ?? [];
  const plan = planSelection({ home, cwd, project, env, desired: selected, previous });
  const normalized = plan.desired;
  if (dryRun) return normalized;
  const parent = path.dirname(file);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  noLinks(parent);
  const temporary = fs.mkdtempSync(path.join(parent, '.selection-'));
  try {
    const staged = path.join(temporary, 'record.json');
    fs.writeFileSync(staged, JSON.stringify({ version: 1, selected: normalized }, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(staged, file);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  return normalized;
}
