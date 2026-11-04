import assert from 'node:assert/strict';
import { mkdtempDisposableSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { privateDir } from '../test/private-dir.js';

// Exercise the installed command and shipped assets outside the source checkout.
// An optional tarball argument lets Release verify the exact asset it publishes.
using disposable = mkdtempDisposableSync(join(tmpdir(), 'tds-package-'));
const temp = disposable.path;
// Installing refuses shared temp folders, so the project installs below use a private folder next to the checkout.
const projects = { path: privateDir('.package-install-') };

const windows = process.platform === 'win32';
/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} [cwd]
 */
function run(command, args, cwd = temp, env = process.env) {
  const shell = windows && command.endsWith('.cmd');
  const result = spawnSync(shell ? `"${command}"` : command, shell ? args.map((arg) => `"${arg}"`) : args, {
    cwd,
    env,
    encoding: 'utf8',
    shell,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command}: ${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}
// A bare quoted npm.cmd resolves its own folder to the current directory in cmd.exe, so run npm's script with node when npm started us.
const npmCli = process.env.npm_execpath?.endsWith('.js') ? process.env.npm_execpath : undefined;
const npm = npmCli ? process.execPath : windows ? 'npm.cmd' : 'npm';
/** @param {string[]} args */
const npmArgs = (args) => (npmCli ? [npmCli, ...args] : args);
let tarball = process.argv[2] && resolve(process.argv[2]);
if (!tarball) {
  run(npm, npmArgs(['pack', '--pack-destination', temp]), process.cwd());
  const packed = readdirSync(temp).find((file) => file.endsWith('.tgz'));
  if (!packed) throw new Error('npm pack made no tarball');
  tarball = join(temp, packed);
}
const prefix = join(temp, 'prefix');
run(
  npm,
  npmArgs([
    'install',
    '--global',
    '--prefix',
    prefix,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--offline',
    tarball,
  ]),
);
const cli = windows ? join(prefix, 'tds-factory.cmd') : join(prefix, 'bin', 'tds-factory');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(run(cli, ['--version']), version);
for (const [agent, skills, agents, extension] of [
  ['claude', '.claude/skills', '.claude/agents', 'md'],
  ['codex', '.agents/skills', '.codex/agents', 'toml'],
  ['copilot', '.github/skills', '.github/agents', 'agent.md'],
]) {
  const project = join(projects.path, agent);
  mkdirSync(project);
  const env = { ...process.env, TDS_FACTORY_CONFIG_DIR: join(projects.path, `config-${agent}`) };
  run(cli, ['install', '--project', '--agent', agent], project, env);
  assert.match(readFileSync(join(project, skills, 'factory', 'SKILL.md'), 'utf8'), /factory/);
  for (const stage of ['define', 'build', 'check', 'finish']) {
    assert.ok(readFileSync(join(project, agents, `factory-${stage}.${extension}`), 'utf8').length);
  }
}
console.log('Packed CLI version and project installs passed for Claude, Codex and Copilot.');
