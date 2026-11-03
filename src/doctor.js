import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git as runGit } from './git.js';
/** @import { AgentName } from './run-record.js' */
/** @typedef {[string, string]} Result A check's status and message. */
import { messageOf } from './narrow.js';
import { ROOT, SKILLS_DIR, AGENTS_DIR } from './paths.js';
import { targets, userDir, agentNames, isAgent } from './flow.js';
import { originDefaultBranch } from './origin.js';
import { invokedByFactory } from './sync.js';
import { verifyCommandProblem, fastCommandProblem, mergedLeftovers } from './run-store.js';
import { loadProjectConfig } from './project-config.js';
import { guidesCheck } from './guides.js';

// The project is not trusted: read only regular files (a link to one is fine) of sane size, never a device or a pipe.
/** @param {string} file */
const read = (file) => {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`${path.basename(file)} is not a regular file`);
  if (stat.size > 1 << 20) throw new Error(`${path.basename(file)} is larger than 1 MiB`);
  return fs.readFileSync(file, 'utf8');
};
/** @param {string} projectDir */
const conventionsFile = (projectDir) =>
  ['AGENTS.md', 'CLAUDE.md'].find((f) => fs.statSync(path.join(projectDir, f), { throwIfNoEntry: false })?.isFile());

/** @returns {Result} */
function cliCheck() {
  const { version, engines } = JSON.parse(read(path.join(ROOT, 'package.json')));
  const major = engines?.node?.match?.(/\d+/)?.[0];
  if (major === undefined) return ['fail', `tds-factory ${version} names no Node version in package.json engines.node`];
  const need = Number(major);
  const have = Number(process.versions.node.split('.')[0]);
  return have < need
    ? ['fail', `tds-factory ${version} needs Node ${need} or newer, found ${process.versions.node}`]
    : ['pass', `tds-factory ${version} on Node ${process.versions.node}`];
}

/**
 * @param {string} projectDir
 * @returns {Result}
 */
function trackerCheck(projectDir) {
  const conventions = conventionsFile(projectDir);
  const missing = ['docs/agents/issue-tracker.md', 'docs/agents/domain.md'].filter(
    (f) => !fs.existsSync(path.join(projectDir, f)),
  );
  if (!conventions) missing.push('AGENTS.md or CLAUDE.md');
  else if (!/^## Agent skills\s*$/m.test(read(path.join(projectDir, conventions))))
    missing.push(`an "## Agent skills" section in ${conventions}`);
  return missing.length
    ? ['missing', `the project's tracker and domain setup is incomplete: ${missing.join(', ')}`]
    : ['pass', 'issue tracker and domain docs are configured'];
}

// The tracker is local when its file names local Markdown or `.scratch/`, or names no tracker at all (the default of to-tickets).
/** @param {string} text */
const isLocalTracker = (text) =>
  /\.scratch\b|\blocal[ -]+markdown\b/i.test(text) ||
  !/\b(github|gitlab|bitbucket|azure[ -]*devops|jira|linear|trello|asana|youtrack|shortcut|clickup)\b/i.test(text);

// Read-only: reports whether git ignores `.scratch/` for a local tracker; the factory Skill's Preflight makes the fix.
/**
 * @param {string} projectDir
 * @returns {Result}
 */
function scratchIgnoreCheck(projectDir) {
  const file = path.join(projectDir, 'docs', 'agents', 'issue-tracker.md');
  if (!fs.existsSync(file)) return ['pass', 'no tracker file; the tracker check reports that'];
  if (!isLocalTracker(read(file))) return ['pass', 'the issue tracker is not local; .scratch/ is not used'];
  const probe = runGit(projectDir, ['check-ignore', '-q', '--no-index', '--', '.scratch/x']);
  if (probe.status === 0) return ['pass', '.scratch/ is ignored by git'];
  if (probe.status !== 1) return ['pass', 'cannot ask git whether .scratch/ is ignored; the git check reports that'];
  return [
    'missing',
    'the issue tracker is local but git does not ignore .scratch/; add ".scratch/" to .gitignore and .git/info/exclude (the factory Skill does this in Preflight)',
  ];
}

/**
 * @param {string} projectDir
 * @returns {Result}
 */
function gitCheck(projectDir) {
  /** @param {...string} args */
  const git = (...args) => runGit(projectDir, args);
  if (git('rev-parse', '--git-dir').status !== 0) return ['fail', 'not a git repository'];
  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0) return ['fail', 'the git repository has no commit'];
  if (git('remote', 'get-url', 'origin').status !== 0) return ['fail', 'there is no origin remote'];
  const { branch, error } = originDefaultBranch(projectDir);
  return branch
    ? ['pass', `origin default branch is ${branch}`]
    : ['fail', `cannot determine the origin default branch: ${error}`];
}

// The optional fast command under "## Commands": quick feedback while building, never Evidence. Absent is fine.
/**
 * @param {string} projectDir
 * @returns {Result}
 */
function verifyFastCheck(projectDir) {
  const file = conventionsFile(projectDir);
  const commands =
    file && read(path.join(projectDir, file)).match(/^## Commands[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1];
  const found = commands?.match(/^[ \t]*[-*][ \t]*Verify-fast:[ \t]*(?:`([^`\n]*)`|(\S[^\n]*))/im);
  const command = found ? (found[1] ?? found[2].trim()) : undefined;
  if (command === undefined) return ['pass', 'no Verify-fast command; every verification runs the full Verify command'];
  const problem = fastCommandProblem(command) ?? (command.trim() ? undefined : 'the fast Verify command is empty');
  if (problem) return ['fail', problem];
  const words = command.trim().split(/\s+/);
  if (words.every((w) => /^[\w.@+/-]+$/.test(w)) && !which(words[0], projectDir))
    return ['fail', `the Verify-fast command "${command.trim()}" starts with "${words[0]}", which was not found`];
  return ['pass', `Verify-fast command: ${command.trim()}`];
}

/**
 * @param {string} projectDir
 * @returns {Result}
 */
function verifyCommandCheck(projectDir) {
  const file = conventionsFile(projectDir);
  const commands =
    file && read(path.join(projectDir, file)).match(/^## Commands[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1];
  const found = commands?.match(/^[ \t]*[-*][ \t]*Verify:[ \t]*(?:`([^`\n]*)`|(\S[^\n]*))/im);
  const command = found ? (found[1] ?? found[2].trim()) : undefined;
  if (command === undefined)
    return [
      'missing',
      'no Verify command found under "## Commands" in AGENTS.md or CLAUDE.md; add a line like "- Verify: `npm test`" (a command in a code block is not read)',
    ];
  const problem = verifyCommandProblem(command);
  if (problem) return ['fail', problem];
  const words = command.trim().split(/\s+/);
  // Only a plain command is probed: anything with shell syntax may be a builtin, a function or an assignment.
  if (words.every((w) => /^[\w.@+/-]+$/.test(w)) && !which(words[0], projectDir))
    return ['fail', `the Verify command "${command.trim()}" starts with "${words[0]}", which was not found`];
  return ['pass', `Verify command: ${command.trim()}`];
}

// Every Skill the factory Skill invokes, found by the phrasing sync and the skills test rely on.
const requiredSkills = () => ['factory', ...invokedByFactory(SKILLS_DIR)];
// Copilot CLI also reads the Claude and Codex Skill folders, and the default install writes only those.
/**
 * @param {AgentName} agent
 * @returns {AgentName[]}
 */
const skillTargets = (agent) => (agent === 'copilot' ? ['copilot', 'claude', 'codex'] : [agent]);
/**
 * @param {AgentName} agent
 * @param {string} projectDir
 * @param {string} homeDir
 * @param {NodeJS.ProcessEnv} env
 * @returns {(name: string, file?: string) => boolean}
 */
const isInstalled =
  (agent, projectDir, homeDir, env) =>
  (name, file = 'SKILL.md') =>
    skillTargets(agent)
      .flatMap((a) => [path.join(projectDir, targets[a].project), userDir(a, 'global', homeDir, env)])
      .some((dir) => fs.existsSync(path.join(dir, name, file)));

/**
 * @param {(name: string, file?: string) => boolean} has
 * @returns {Result}
 */
function skillsCheck(has) {
  const missing = requiredSkills().filter((name) => !has(name));
  if (missing.length) return ['fail', `required Skills not installed: ${missing.join(', ')}`];
  // The factory Skill names reference files next to it; an install from before they existed leaves them out.
  const shipped = fs.readdirSync(path.join(SKILLS_DIR, 'factory', 'references')).filter((f) => f.endsWith('.md'));
  const absent = shipped.filter((f) => !has('factory', `references/${f}`));
  return absent.length
    ? ['fail', `the factory Skill is missing its reference files: ${absent.join(', ')}; run tds-factory install`]
    : ['pass', 'all required Skills are installed'];
}

// Review needs its two Skills and the read-only reviewer; without the reviewer Check cannot run its axes independently.
/**
 * @param {AgentName} agent
 * @param {string} projectDir
 * @param {string} homeDir
 * @param {(name: string, file?: string) => boolean} has
 * @param {NodeJS.ProcessEnv} env
 * @returns {Result}
 */
function reviewCheck(agent, projectDir, homeDir, has, env) {
  const { reviews } = loadProjectConfig(projectDir, agent, homeDir, env);
  const missing = ['code-review', 'security-scan'].filter((name) => !has(name));
  const file = fs.readdirSync(path.join(AGENTS_DIR, agent)).find((f) => f.startsWith('factory-check.'));
  const agentDirs = [path.join(projectDir, targets[agent].projectAgents), userDir(agent, 'agents', homeDir, env)];
  if (!file || !agentDirs.some((dir) => fs.existsSync(path.join(dir, file))))
    missing.push(`the factory-check Stage agent (${file ?? 'factory-check.*'})`);
  if (reviews.some((review) => review.mode === 'interactive')) {
    const interactive = fs
      .readdirSync(path.join(AGENTS_DIR, agent))
      .find((f) => f.startsWith('factory-interactive-check.'));
    if (!interactive || !agentDirs.some((dir) => fs.existsSync(path.join(dir, interactive))))
      missing.push('the factory-interactive-check agent');
  }
  return missing.length
    ? ['fail', `review is not available, missing: ${missing.join(', ')}`]
    : ['pass', 'review Skills and the read-only factory-check agent are installed'];
}

// A project's .factory/config.json is optional; when present, a bad value is named with its line so it can be fixed before a Run freezes it.
/**
 * @param {AgentName} agent
 * @param {string} projectDir
 * @param {string} homeDir
 * @param {NodeJS.ProcessEnv} env
 * @returns {Result}
 */
function configCheck(agent, projectDir, homeDir, env) {
  const config = loadProjectConfig(projectDir, agent, homeDir, env);
  const file = path.join(projectDir, '.factory', 'config.json');
  if (!fs.existsSync(file)) return ['pass', 'no .factory/config.json; the Factory defaults apply'];
  const set = [
    Object.keys(config.models).length && 'models',
    config.max_check_loops !== 4 && 'max_check_loops',
    JSON.stringify(config.labels) !== JSON.stringify({ ticket: 'ready-for-agent' }) && 'labels',
    config.usage === false && 'usage',
    config.reviews.length && 'reviews',
  ].filter(Boolean);
  return ['pass', `.factory/config.json is valid${set.length ? ` (${set.join(', ')})` : ''}`];
}

// On Windows a command is found with any of the PATHEXT extensions (npm.cmd, claude.exe).
/**
 * @param {string} name
 * @param {string} [cwd]
 */
function which(name, cwd = process.cwd()) {
  if (name.includes('/') || (process.platform === 'win32' && name.includes('\\')))
    return fs.existsSync(path.resolve(cwd, name));
  const extensions =
    process.platform === 'win32'
      ? ['', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((ext) => /^\.\w+$/.test(ext))]
      : [''];
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .some((dir) => dir && extensions.some((ext) => fs.existsSync(path.join(dir, name + ext))));
}

const NO_AGENT = 'no agent is usable: install claude, codex or copilot and run tds-factory install';

// The command an Agent target is started with is its name.
/**
 * @param {string} agent
 * @returns {Result}
 */
function binaryCheck(agent) {
  return which(agent) ? ['pass', `${agent} found on PATH`] : ['missing', `${agent} not found on PATH`];
}

// Checks, without changing anything, whether a project is ready for a Run. `missing` is something the user can supply.
// Without `agent` every Agent target is reported and one usable target is enough; with `agent` only that target is, and its command need not be on PATH.
/**
 * @param {object} options
 * @param {string} options.projectDir
 * @param {string} [options.agent]
 * @param {string} [options.homeDir]
 * @param {import('./run-clean.js').SyncPrLookup} [options.prState]
 * @param {NodeJS.ProcessEnv} [options.env]
 */
export function doctor({ projectDir, agent, homeDir = os.homedir(), prState, env = process.env }) {
  if (agent !== undefined && !isAgent(agent)) throw new Error(`unknown agent "${agent}" (${agentNames.join(', ')})`);
  // Git resolves the current worktree (including linked worktrees), not the shared main checkout.
  const root = runGit(projectDir, ['rev-parse', '--show-toplevel']);
  const worktreeRoot = root.stdout?.replace(process.platform === 'win32' ? /\r?\n$/ : /\n$/, '');
  if (root.status === 0 && worktreeRoot) projectDir = worktreeRoot;
  // An unreadable project file is a failed check, not a crash, so the report always has every check.
  /** @param {[string, () => Result]} entry */
  const attempt = ([id, check]) => {
    /** @type {Result} */
    let result;
    try {
      result = check();
    } catch (err) {
      result = ['fail', messageOf(err)];
    }
    return { id, status: result[0], message: result[1] };
  };
  /** @type {[string, () => Result][]} */
  const planned = [
    ['cli', cliCheck],
    ['tracker', () => trackerCheck(projectDir)],
    ['git', () => gitCheck(projectDir)],
    ['verify-command', () => verifyCommandCheck(projectDir)],
    ['verify-fast', () => verifyFastCheck(projectDir)],
    ['scratch-ignore', () => scratchIgnoreCheck(projectDir)],
    ['guides', () => guidesCheck(projectDir)],
  ];
  const checks = planned.map(attempt);
  const agents = (agent === undefined ? agentNames : [agent]).map((id) => {
    const has = isInstalled(id, projectDir, homeDir, env);
    /** @type {[string, () => Result][]} */
    const perAgent = [
      ['binary', () => binaryCheck(id)],
      ['skills', () => skillsCheck(has)],
      ['config', () => configCheck(id, projectDir, homeDir, env)],
      ['review', () => reviewCheck(id, projectDir, homeDir, has, env)],
    ];
    const list = perAgent.map(attempt);
    return { id, usable: list.every((c) => c.status === 'pass'), checks: list };
  });
  // The optional Verify-fast command and the scratch-ignore check are shown but never fail the report.
  let ok = checks.every((c) => c.status === 'pass' || c.id === 'verify-fast' || c.id === 'scratch-ignore');
  if (agent === undefined) {
    const anyUsable = agents.some((a) => a.usable);
    if (!anyUsable) checks.push({ id: 'agents', status: 'fail', message: NO_AGENT });
    ok = ok && anyUsable;
  } else ok = ok && agents[0].checks.every((c) => c.id === 'binary' || c.status === 'pass');
  // Not a check: merged Runs that kept a worktree or branch never stop a Run, they only deserve a hint.
  const left = checks.find((c) => c.id === 'git')?.status === 'pass' ? mergedLeftovers(projectDir, prState) : [];
  const notes = left.length
    ? [
        `${left.length} Run${left.length === 1 ? ' is' : 's are'} merged but still hold a worktree or branch (${left.join(', ')}); run \`tds-factory run clean --all\` from the main checkout`,
      ]
    : [];
  return { ok, checks, agents, notes };
}
