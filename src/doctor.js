import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, SKILLS_DIR, AGENTS_DIR } from './paths.js';
import { targets } from './flow.js';
import { originDefaultBranch } from './origin.js';
import { invokedByFactory } from './sync.js';
import { verifyCommandProblem, fastCommandProblem, mergedLeftovers } from './run-store.js';
import { loadProjectConfig } from './project-config.js';
import { guidesCheck } from './guides.js';

// The project is not trusted: read only regular files (a link to one is fine) of sane size, never a device or a pipe.
const read = (file) => {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`${path.basename(file)} is not a regular file`);
  if (stat.size > 1 << 20) throw new Error(`${path.basename(file)} is larger than 1 MiB`);
  return fs.readFileSync(file, 'utf8');
};
const conventionsFile = (projectDir) => ['AGENTS.md', 'CLAUDE.md'].find((f) => fs.statSync(path.join(projectDir, f), { throwIfNoEntry: false })?.isFile());

function cliCheck() {
  const { version, engines } = JSON.parse(read(path.join(ROOT, 'package.json')));
  const need = Number(engines.node.match(/\d+/)[0]);
  const have = Number(process.versions.node.split('.')[0]);
  return have < need ? ['fail', `tds-factory ${version} needs Node ${need} or newer, found ${process.versions.node}`] : ['pass', `tds-factory ${version} on Node ${process.versions.node}`];
}

function trackerCheck(projectDir) {
  const conventions = conventionsFile(projectDir);
  const missing = ['docs/agents/issue-tracker.md', 'docs/agents/domain.md'].filter((f) => !fs.existsSync(path.join(projectDir, f)));
  if (!conventions) missing.push('AGENTS.md or CLAUDE.md');
  else if (!/^## Agent skills\s*$/m.test(read(path.join(projectDir, conventions)))) missing.push(`an "## Agent skills" section in ${conventions}`);
  return missing.length ? ['missing', `the project's tracker and domain setup is incomplete: ${missing.join(', ')}`] : ['pass', 'issue tracker and domain docs are configured'];
}

function gitCheck(projectDir) {
  const git = (...args) => spawnSync('git', args, { cwd: projectDir, encoding: 'utf8' });
  if (git('rev-parse', '--git-dir').status !== 0) return ['fail', 'not a git repository'];
  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0) return ['fail', 'the git repository has no commit'];
  if (git('remote', 'get-url', 'origin').status !== 0) return ['fail', 'there is no origin remote'];
  const { branch, error } = originDefaultBranch(projectDir);
  return branch ? ['pass', `origin default branch is ${branch}`] : ['fail', `cannot determine the origin default branch: ${error}`];
}

// The optional fast command under "## Commands": quick feedback while building, never Evidence. Absent is fine.
function verifyFastCheck(projectDir) {
  const file = conventionsFile(projectDir);
  const commands = file && read(path.join(projectDir, file)).match(/^## Commands[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1];
  const found = commands?.match(/^[ \t]*[-*][ \t]*Verify-fast:[ \t]*(?:`([^`\n]*)`|(\S[^\n]*))/mi);
  const command = found ? (found[1] ?? found[2].trim()) : undefined;
  if (command === undefined) return ['pass', 'no Verify-fast command; every verification runs the full Verify command'];
  const problem = fastCommandProblem(command) ?? (command.trim() ? undefined : 'the fast Verify command is empty');
  if (problem) return ['fail', problem];
  const words = command.trim().split(/\s+/);
  if (words.every((w) => /^[\w.@+\/-]+$/.test(w)) && !which(words[0], projectDir)) return ['fail', `the Verify-fast command "${command.trim()}" starts with "${words[0]}", which was not found`];
  return ['pass', `Verify-fast command: ${command.trim()}`];
}

function verifyCommandCheck(projectDir) {
  const file = conventionsFile(projectDir);
  const commands = file && read(path.join(projectDir, file)).match(/^## Commands[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1];
  const found = commands?.match(/^[ \t]*[-*][ \t]*Verify:[ \t]*(?:`([^`\n]*)`|(\S[^\n]*))/mi);
  const command = found ? (found[1] ?? found[2].trim()) : undefined;
  if (command === undefined) return ['missing', 'no Verify command found under "## Commands" in AGENTS.md or CLAUDE.md; add a line like "- Verify: `npm test`" (a command in a code block is not read)'];
  const problem = verifyCommandProblem(command);
  if (problem) return ['fail', problem];
  const words = command.trim().split(/\s+/);
  // Only a plain command is probed: anything with shell syntax may be a builtin, a function or an assignment.
  if (words.every((w) => /^[\w.@+\/-]+$/.test(w)) && !which(words[0], projectDir)) return ['fail', `the Verify command "${command.trim()}" starts with "${words[0]}", which was not found`];
  return ['pass', `Verify command: ${command.trim()}`];
}

// Every Skill the factory Skill invokes, found by the phrasing sync and the skills test rely on.
const requiredSkills = () => ['factory', ...invokedByFactory(SKILLS_DIR)];
// Copilot CLI also reads the Claude and Codex Skill folders, and the default install writes only those.
const skillTargets = (agent) => (agent === 'copilot' ? ['copilot', 'claude', 'codex'] : [agent]);
const isInstalled = (agent, projectDir, homeDir) => (name, file = 'SKILL.md') => skillTargets(agent)
  .flatMap((a) => [path.join(projectDir, targets[a].project), path.join(homeDir, targets[a].global)])
  .some((dir) => fs.existsSync(path.join(dir, name, file)));

function skillsCheck(has) {
  const missing = requiredSkills().filter((name) => !has(name));
  if (missing.length) return ['fail', `required Skills not installed: ${missing.join(', ')}`];
  // The factory Skill names reference files next to it; an install from before they existed leaves them out.
  const shipped = fs.readdirSync(path.join(SKILLS_DIR, 'factory', 'references')).filter((f) => f.endsWith('.md'));
  const absent = shipped.filter((f) => !has('factory', `references/${f}`));
  return absent.length ? ['fail', `the factory Skill is missing its reference files: ${absent.join(', ')}; run tds-factory install`] : ['pass', 'all required Skills are installed'];
}

// Review needs its two Skills and the read-only reviewer; without the reviewer Check cannot run its axes independently.
function reviewCheck(agent, projectDir, homeDir, has) {
  const { reviews } = loadProjectConfig(projectDir, agent, homeDir);
  const missing = ['code-review', 'security-scan'].filter((name) => !has(name));
  const file = fs.readdirSync(path.join(AGENTS_DIR, agent)).find((f) => f.startsWith('factory-check.'));
  const agentDirs = [path.join(projectDir, targets[agent].projectAgents), path.join(homeDir, targets[agent].agents)];
  if (!agentDirs.some((dir) => fs.existsSync(path.join(dir, file)))) missing.push(`the factory-check Stage agent (${file})`);
  if (reviews.some(review => review.mode === 'interactive')) {
    const interactive = fs.readdirSync(path.join(AGENTS_DIR, agent)).find(f => f.startsWith('factory-interactive-check.'));
    if (!interactive || !agentDirs.some(dir => fs.existsSync(path.join(dir, interactive)))) missing.push('the factory-interactive-check agent');
  }
  return missing.length ? ['fail', `review is not available, missing: ${missing.join(', ')}`] : ['pass', 'review Skills and the read-only factory-check agent are installed'];
}

// A project's .factory/config.json is optional; when present, a bad value is named with its line so it can be fixed before a Run freezes it.
function configCheck(agent, projectDir, homeDir) {
  const config = loadProjectConfig(projectDir, agent, homeDir);
  const file = path.join(projectDir, '.factory', 'config.json');
  if (!fs.existsSync(file)) return ['pass', 'no .factory/config.json; the Factory defaults apply'];
  const set = [Object.keys(config.models).length && 'models', config.max_check_loops !== 4 && 'max_check_loops', JSON.stringify(config.labels) !== JSON.stringify({ ticket: 'ready-for-agent' }) && 'labels', config.reviews.length && 'reviews'].filter(Boolean);
  return ['pass', `.factory/config.json is valid${set.length ? ` (${set.join(', ')})` : ''}`];
}

function which(name, cwd) {
  if (name.includes('/')) return fs.existsSync(path.resolve(cwd, name));
  return (process.env.PATH ?? '').split(path.delimiter).some((dir) => dir && fs.existsSync(path.join(dir, name)));
}

const NO_AGENT = 'no agent is usable: install claude, codex or copilot and run tds-factory install';

// The command an Agent target is started with is its name. On Windows a command is found with any of the PATHEXT extensions (claude.exe, claude.cmd).
function binaryCheck(agent) {
  const extensions = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((ext) => /^\.\w+$/.test(ext))] : [''];
  const found = extensions.some((ext) => which(agent + ext));
  return found ? ['pass', `${agent} found on PATH`] : ['missing', `${agent} not found on PATH`];
}

// Checks, without changing anything, whether a project is ready for a Run. `missing` is something the user can supply.
// Without `agent` every Agent target is reported and one usable target is enough; with `agent` only that target is, and its command need not be on PATH.
export function doctor({ projectDir, agent, homeDir = os.homedir(), prState }) {
  if (agent !== undefined && !Object.hasOwn(targets, agent)) throw new Error(`unknown agent "${agent}" (${Object.keys(targets).join(', ')})`);
  // Git resolves the current worktree (including linked worktrees), not the shared main checkout.
  const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: projectDir, encoding: 'utf8' });
  const worktreeRoot = root.stdout?.replace(process.platform === 'win32' ? /\r?\n$/ : /\n$/, '');
  if (root.status === 0 && worktreeRoot) projectDir = worktreeRoot;
  // An unreadable project file is a failed check, not a crash, so the report always has every check.
  const attempt = ([id, check]) => { let result; try { result = check(); } catch (err) { result = ['fail', err.message]; } return { id, status: result[0], message: result[1] }; };
  const checks = [['cli', cliCheck], ['tracker', () => trackerCheck(projectDir)], ['git', () => gitCheck(projectDir)], ['verify-command', () => verifyCommandCheck(projectDir)], ['verify-fast', () => verifyFastCheck(projectDir)], ['guides', () => guidesCheck(projectDir)]].map(attempt);
  const agents = (agent === undefined ? Object.keys(targets) : [agent]).map((id) => {
    const has = isInstalled(id, projectDir, homeDir);
    const list = [['binary', () => binaryCheck(id)], ['skills', () => skillsCheck(has)], ['config', () => configCheck(id, projectDir, homeDir)], ['review', () => reviewCheck(id, projectDir, homeDir, has)]].map(attempt);
    return { id, usable: list.every((c) => c.status === 'pass'), checks: list };
  });
  // The optional Verify-fast command is shown when unusable but never fails the report.
  let ok = checks.every((c) => c.status === 'pass' || c.id === 'verify-fast');
  if (agent === undefined) {
    const anyUsable = agents.some((a) => a.usable);
    if (!anyUsable) checks.push({ id: 'agents', status: 'fail', message: NO_AGENT });
    ok = ok && anyUsable;
  } else ok = ok && agents[0].checks.every((c) => c.id === 'binary' || c.status === 'pass');
  // Not a check: merged Runs that kept a worktree or branch never stop a Run, they only deserve a hint.
  const left = checks.find((c) => c.id === 'git')?.status === 'pass' ? mergedLeftovers(projectDir, prState) : [];
  const notes = left.length ? [`${left.length} Run${left.length === 1 ? ' is' : 's are'} merged but still hold a worktree or branch (${left.join(', ')}); run \`tds-factory run clean --all\` from the main checkout`] : [];
  return { ok, checks, agents, notes };
}
