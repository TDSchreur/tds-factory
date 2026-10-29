import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const EVAL_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin');
const CLI = join(EVAL_BIN, 'tds-factory');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.com', ...args], { cwd, encoding: 'utf8' }).trim();
const write = (dir, file, text) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
};

// A small project with a local bare origin, the setup docs the Factory's Preflight needs, and the Factory installed for `agent`.
export function fixture({ agent, verify = 'exit 0' } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'factory-eval-')));
  const origin = join(root, 'origin.git');
  const dir = join(root, 'project');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, dir);
  write(dir, 'AGENTS.md', '# Agents\n\n## Agent skills\n\n### Issue tracker\n\nIssues live in GitHub Issues. See `docs/agents/issue-tracker.md`.\n\n### Domain docs\n\nSingle-context layout. See `docs/agents/domain.md`.\n\n## Commands\n\n- Verify: `sh verify.sh`\n');
  write(dir, 'docs/agents/issue-tracker.md', '# Issue Tracker\n\nIssues live in **GitHub Issues**. Create with `gh issue create`. Tickets carry the `ready-for-agent` label.\n');
  write(dir, 'docs/agents/domain.md', '# Domain Docs\n\nSingle-context layout: `GLOSSARY.md` at the root, ADRs in `docs/adr/`.\n');
  write(dir, 'GLOSSARY.md', '# Fixture\n\n## Language\n\n**Greeting**:\nThe text the program prints.\n');
  write(dir, 'verify.sh', `${verify}\n`);
  write(dir, 'greet.js', "export const greet = (name) => `Hello, ${name}`;\n");
  write(dir, '.gitignore', '.factory/\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixture');
  git(dir, 'push', '-q', 'origin', 'main');
  const actionLog = join(root, 'actions.jsonl');
  write(dir, '.git/hooks/pre-push', `#!/bin/sh\nprintf '{"tool":"git","argv":["push","%s","%s"],"write":true}\\n' "$1" "$2" >> "${actionLog}"\n`);
  chmodSync(join(dir, '.git/hooks/pre-push'), 0o755);
  const env = { ...process.env, PATH: `${EVAL_BIN}:${process.env.PATH}`, EVAL_ACTION_LOG: actionLog, EVAL_GH_STATE: join(root, 'gh-state.json') };
  const factory = (...args) => execFileSync(CLI, args, { cwd: dir, env, encoding: 'utf8' }).trim();
  factory('install', '--agent', agent, '--project');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'install factory');
  git(dir, 'push', '-q', 'origin', 'main');
  writeFileSync(actionLog, '');
  return { root, dir, origin, actionLog, env, agent, git: (...a) => git(dir, ...a), factory, write: (f, t) => write(dir, f, t) };
}

// Starts a Run the way /factory does and returns its id.
export function startRun(fx, title = 'Eval run') {
  return fx.factory('run', 'start', '--data', JSON.stringify({ title, agent: fx.agent, commands: 'sh verify.sh', conventions: ['AGENTS.md'] }));
}

// Starts a Run and drives it, through the Run commands, to the given point: `build`, `check`, `evidence` (Check with Verify and every verdict recorded)
// or `finish` (the branch is also pushed). The worktree holds a Spec, one Ticket and one implementation commit once past `build`.
export function runAt(fx, upTo, title = 'Add a shout function') {
  const id = startRun(fx, title);
  const wt = JSON.parse(fx.factory('run', 'inspect', '--id', id, '--json')).worktree ?? join(fx.dir, '.factory', 'worktrees', id);
  const wgit = (...a) => git(wt, ...a);
  const update = (data) => fx.factory('run', 'update', '--id', id, '--data', JSON.stringify(data));
  const to = (stage) => fx.factory('run', 'transition', '--id', id, '--to', stage);
  write(wt, 'docs/specs/shout.md', '# Shout\n\n## Problem Statement\n\nGreetings cannot be shouted.\n');
  wgit('add', '-A');
  wgit('commit', '-q', '-m', 'Spec');
  update({ spec_link: 'docs/specs/shout.md', tickets: ['https://github.com/eval/fixture/issues/1'], tickets_total: 1 });
  to('prepare');
  to('build');
  if (upTo === 'build') return { id, wt };
  write(wt, 'greet.js', "export const greet = (name) => `Hello, ${name}`;\nexport const shout = (name) => greet(name).toUpperCase();\n");
  wgit('add', '-A');
  wgit('commit', '-q', '-m', 'Add shout');
  update({ tickets_done: 1 });
  to('check');
  if (upTo === 'check') return { id, wt };
  fx.factory('run', 'verify', '--id', id);
  for (const [axis, value] of [['standards', 'pass'], ['spec', 'pass'], ['security', 'pass'], ['infrastructure', 'skipped']]) {
    fx.factory('run', 'verdict', '--id', id, '--axis', axis, '--value', value);
  }
  if (upTo === 'evidence') return { id, wt };
  to('finish');
  wgit('push', '-q', 'origin', id);
  return { id, wt };
}
