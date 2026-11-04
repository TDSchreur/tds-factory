import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const EVAL_BIN = join(import.meta.dirname, '..', 'bin');
const CLI = join(EVAL_BIN, 'tds-factory');

/**
 * @param {string} cwd
 * @param {...string} args
 */
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.com', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
/** @param {string} dir @param {string} file @param {string} text */
const write = (dir, file, text) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
};

/** @typedef {ReturnType<typeof fixture>} Fixture */

// A small project with a local bare origin, the setup docs the Factory's Preflight needs, and the Factory installed for `agent`.
/**
 * @param {{ agent: string, verify?: string }} options
 */
export function fixture({ agent, verify = 'exit 0' }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'factory-eval-')));
  const origin = join(root, 'origin.git');
  const dir = join(root, 'project');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, dir);
  write(
    dir,
    'AGENTS.md',
    '# Agents\n\n## Agent skills\n\n### Issue tracker\n\nIssues live in GitHub Issues. See `docs/agents/issue-tracker.md`.\n\n### Domain docs\n\nSingle-context layout. See `docs/agents/domain.md`.\n\n## Commands\n\n- Verify: `sh verify.sh`\n',
  );
  write(
    dir,
    'docs/agents/issue-tracker.md',
    '# Issue Tracker\n\nIssues live in **GitHub Issues**. Create with `gh issue create`. Tickets carry the `ready-for-agent` label.\n',
  );
  write(
    dir,
    'docs/agents/domain.md',
    '# Domain Docs\n\nSingle-context layout: `GLOSSARY.md` at the root, ADRs in `docs/adr/`.\n',
  );
  write(dir, 'GLOSSARY.md', '# Fixture\n\n## Language\n\n**Greeting**:\nThe text the program prints.\n');
  write(dir, 'verify.sh', `${verify}\n`);
  write(dir, 'greet.js', 'export const greet = (name) => `Hello, ${name}`;\n');
  write(dir, '.gitignore', '.factory/\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixture');
  git(dir, 'push', '-q', 'origin', 'main');
  const actionLog = join(root, 'actions.jsonl');
  write(
    dir,
    '.git/hooks/pre-push',
    `#!/bin/sh\nprintf '{"tool":"git","argv":["push","%s","%s"],"write":true}\\n' "$1" "$2" >> "${actionLog}"\n[ "$2" = "${origin}" ] || { echo "eval: pushes may only go to the local origin" >&2; exit 1; }\n`,
  );
  chmodSync(join(dir, '.git/hooks/pre-push'), 0o755);
  const env = {
    ...process.env,
    PATH: `${EVAL_BIN}:${process.env.PATH}`,
    TDS_FACTORY_CONFIG_DIR: join(root, 'factory-config'), // a Run started here must not join the Project registry of the person running the eval
    EVAL_ACTION_LOG: actionLog,
    EVAL_GH_STATE: join(root, 'gh-state.json'),
  };
  /** @param {...string} args */
  const factory = (...args) => execFileSync(CLI, args, { cwd: dir, env, encoding: 'utf8' }).trim();
  // The fixture lives in a temp folder that the real trusted-path check refuses, so it skips that check.
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { install } from ${JSON.stringify(pathToFileURL(join(dirname(CLI), '..', '..', 'src', 'install.js')).href)}; install({ agent: process.argv[1], project: true, verifyPaths: () => {}, log() {} });`,
      agent,
    ],
    { cwd: dir, env, encoding: 'utf8' },
  );
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'install factory');
  git(dir, 'push', '-q', 'origin', 'main');
  writeFileSync(actionLog, '');
  return {
    root,
    dir,
    origin,
    actionLog,
    env,
    agent,
    /** @param {...string} a */
    git: (...a) => git(dir, ...a),
    factory,
    /** @param {string} f @param {string} t */
    write: (f, t) => write(dir, f, t),
  };
}

// Starts a Run the way /factory does and returns its id.
/**
 * @param {Fixture} fx
 * @param {string} [title]
 */
export function startRun(fx, title = 'Eval run') {
  return fx.factory(
    'run',
    'start',
    '--data',
    JSON.stringify({ title, agent: fx.agent, commands: 'sh verify.sh', conventions: ['AGENTS.md'] }),
  );
}

// Starts a Run and drives it, through the Run commands, to the given point: `build`, `check`, `evidence` (Check with Verify and every verdict recorded)
// or `finish` (the branch is also pushed). The worktree holds a Spec, one Ticket and one implementation commit once past `build`.
/**
 * @param {Fixture} fx
 * @param {'build' | 'check' | 'evidence' | 'finish'} upTo
 * @param {string} [title]
 */
export function runAt(fx, upTo, title = 'Add a shout function') {
  const id = startRun(fx, title);
  const wt =
    JSON.parse(fx.factory('run', 'inspect', '--id', id, '--json')).worktree ??
    join(fx.dir, '.factory', 'worktrees', id);
  /** @param {...string} a */
  const wgit = (...a) => git(wt, ...a);
  /** @param {object} data */
  const update = (data) => fx.factory('run', 'update', '--id', id, '--data', JSON.stringify(data));
  /** @param {string} stage */
  const to = (stage) => fx.factory('run', 'transition', '--id', id, '--to', stage);
  write(wt, 'docs/specs/shout.md', '# Shout\n\n## Problem Statement\n\nGreetings cannot be shouted.\n');
  wgit('add', '-A');
  wgit('commit', '-q', '-m', 'Spec');
  update({ spec_link: 'docs/specs/shout.md', tickets: ['https://github.com/eval/fixture/issues/1'], tickets_total: 1 });
  to('build');
  if (upTo === 'build') return { id, wt };
  write(
    wt,
    'greet.js',
    'export const greet = (name) => `Hello, ${name}`;\nexport const shout = (name) => greet(name).toUpperCase();\n',
  );
  wgit('add', '-A');
  wgit('commit', '-q', '-m', 'Add shout');
  update({ tickets_done: 1 });
  to('check');
  if (upTo === 'check') return { id, wt };
  fx.factory('run', 'verify', '--id', id);
  for (const [axis, value] of [
    ['standards', 'pass'],
    ['spec', 'pass'],
    ['security', 'pass'],
    ['infrastructure', 'skipped'],
  ]) {
    fx.factory('run', 'verdict', '--id', id, '--axis', axis, '--value', value);
  }
  if (upTo === 'evidence') return { id, wt };
  to('finish');
  wgit('push', '-q', 'origin', id);
  return { id, wt };
}
