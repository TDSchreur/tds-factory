import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, SKILLS_DIR, AGENTS_DIR } from './paths.js';
import { targets } from './flow.js';
import { originDefaultBranch } from './origin.js';
import { invokedByFactory } from './sync.js';
import { verifyCommandProblem } from './run-store.js';

// The project is not trusted: read only regular files of sane size, never a link to a device or a pipe.
const read = (file) => {
  if (fs.statSync(file).size > 1 << 20) throw new Error(`${path.basename(file)} is larger than 1 MiB`);
  return fs.readFileSync(file, 'utf8');
};
const conventionsFile = (projectDir) => ['AGENTS.md', 'CLAUDE.md'].find((f) => fs.lstatSync(path.join(projectDir, f), { throwIfNoEntry: false })?.isFile());

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

function verifyCommandCheck(projectDir) {
  const file = conventionsFile(projectDir);
  const commands = file && read(path.join(projectDir, file)).match(/^## Commands[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1];
  const found = commands?.match(/^[ \t]*[-*][ \t]*Verify:[ \t]*(?:`([^`\n]*)`|(\S[^\n]*))/mi);
  const command = found && (found[1] ?? found[2].trim());
  if (command === undefined) return ['missing', 'no Verify command found under "## Commands" in AGENTS.md or CLAUDE.md'];
  const problem = verifyCommandProblem(command);
  if (problem) return ['fail', problem];
  const words = command.trim().split(/\s+/);
  // Only a plain command is probed: anything with shell syntax may be a builtin, a function or an assignment.
  if (words.every((w) => /^[\w.@+\/-]+$/.test(w)) && !which(words[0], projectDir)) return ['fail', `the Verify command "${command.trim()}" starts with "${words[0]}", which was not found`];
  return ['pass', `Verify command: ${command.trim()}`];
}

// Every Skill the factory Skill invokes, found by the phrasing sync and the skills test rely on.
const requiredSkills = () => ['factory', ...invokedByFactory(SKILLS_DIR)];
const isInstalled = (agent, projectDir, homeDir) => (name) => [path.join(projectDir, targets[agent].project), path.join(homeDir, targets[agent].global)]
  .some((dir) => fs.existsSync(path.join(dir, name, 'SKILL.md')));

function skillsCheck(has) {
  const missing = requiredSkills().filter((name) => !has(name));
  return missing.length ? ['fail', `required Skills not installed: ${missing.join(', ')}`] : ['pass', 'all required Skills are installed'];
}

// Review needs its two Skills and the read-only reviewer; without the reviewer Check cannot run its axes independently.
function reviewCheck(agent, projectDir, homeDir, has) {
  const missing = ['code-review', 'security-scan'].filter((name) => !has(name));
  const file = fs.readdirSync(path.join(AGENTS_DIR, agent)).find((f) => f.startsWith('factory-check.'));
  if (![path.join(projectDir, targets[agent].projectAgents), path.join(homeDir, targets[agent].agents)].some((dir) => fs.existsSync(path.join(dir, file)))) missing.push(`the factory-check Stage agent (${file})`);
  return missing.length ? ['fail', `review is not available, missing: ${missing.join(', ')}`] : ['pass', 'review Skills and the read-only factory-check agent are installed'];
}

function which(name, cwd) {
  if (name.includes('/')) return fs.existsSync(path.resolve(cwd, name));
  return (process.env.PATH ?? '').split(path.delimiter).some((dir) => dir && fs.existsSync(path.join(dir, name)));
}

// Checks, without changing anything, whether a project is ready for a Run. `missing` is something the user can supply.
export function doctor({ projectDir, agent = 'claude', homeDir = os.homedir() }) {
  if (!Object.hasOwn(targets, agent)) throw new Error(`unknown agent "${agent}" (${Object.keys(targets).join(', ')})`);
  const has = isInstalled(agent, projectDir, homeDir);
  const checks = [['cli', cliCheck()], ['skills', skillsCheck(has)], ['tracker', trackerCheck(projectDir)], ['git', gitCheck(projectDir)], ['review', reviewCheck(agent, projectDir, homeDir, has)], ['verify-command', verifyCommandCheck(projectDir)]]
    .map(([id, [status, message]]) => ({ id, status, message }));
  return { ok: checks.every((c) => c.status === 'pass'), checks };
}
