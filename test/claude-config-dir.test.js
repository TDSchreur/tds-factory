import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { claudeHome, userDir } from '../src/flow.js';
import { install } from '../src/install.js';
import { doctor } from '../src/doctor.js';
import { readClaudeUsage } from '../src/usage-claude.js';
import { loadProjectReviews } from '../src/project-reviews.js';

const temp = (name) => mkdtempSync(join(tmpdir(), `${name}-`));

test('claudeHome is CLAUDE_CONFIG_DIR when non-empty, else ~/.claude', () => {
  const home = temp('cfg-home');
  assert.equal(claudeHome(home, {}), join(home, '.claude'));
  assert.equal(claudeHome(home, { CLAUDE_CONFIG_DIR: '' }), join(home, '.claude'));
  assert.equal(claudeHome(home, { CLAUDE_CONFIG_DIR: '/x/cfg' }), resolve('/x/cfg'));
});

test('claudeHome resolves a relative value and drops a trailing separator', () => {
  const home = temp('cfg-home');
  assert.equal(claudeHome(home, { CLAUDE_CONFIG_DIR: 'rel/cfg' }), resolve('rel/cfg'));
  const trailing = claudeHome(home, { CLAUDE_CONFIG_DIR: `${resolve('/x/cfg')}${sep}` });
  assert.equal(trailing, resolve('/x/cfg'));
  assert.equal(
    userDir('claude', 'agents', home, { CLAUDE_CONFIG_DIR: `${resolve('/x/cfg')}${sep}` }),
    join(trailing, 'agents'),
  );
});

test('userDir moves only the Claude folders', () => {
  const home = temp('cfg-home');
  const env = { CLAUDE_CONFIG_DIR: resolve('/x/cfg') };
  assert.equal(userDir('claude', 'global', home, env), join(resolve('/x/cfg'), 'skills'));
  assert.equal(userDir('codex', 'global', home, env), join(home, '.agents', 'skills'));
  assert.equal(userDir('codex', 'agents', home, env), join(home, '.codex', 'agents'));
  assert.equal(userDir('copilot', 'global', home, env), join(home, '.copilot', 'skills'));
});

test('install writes the Claude skills and agents to CLAUDE_CONFIG_DIR, not ~/.claude', () => {
  const home = temp('cfg-home');
  const cfg = temp('cfg-dir');
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, CCD: process.env.CLAUDE_CONFIG_DIR };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  const log = mock.method(console, 'log', () => {});
  try {
    install({ agent: 'claude', project: false, force: false });
  } finally {
    log.mock.restore();
    process.env.HOME = saved.HOME;
    process.env.USERPROFILE = saved.USERPROFILE;
    if (saved.CCD === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved.CCD;
  }
  assert.ok(existsSync(join(cfg, 'skills', 'factory', 'SKILL.md')));
  assert.ok(existsSync(join(cfg, 'agents', 'factory-build.md')));
  assert.equal(existsSync(join(home, '.claude')), false);
});

test('doctor reads the Claude skills from CLAUDE_CONFIG_DIR', () => {
  const home = temp('cfg-home');
  const cfg = temp('cfg-dir');
  const project = temp('cfg-project');
  mkdirSync(join(cfg, 'skills', 'factory'), { recursive: true });
  writeFileSync(join(cfg, 'skills', 'factory', 'SKILL.md'), 'x');
  const skills = (env) =>
    doctor({
      projectDir: project,
      agent: 'claude',
      homeDir: home,
      prState: () => undefined,
      env,
    }).agents[0].checks.find((c) => c.id === 'skills');
  // Present only in the configured folder: the factory Skill is found there, and not without the variable.
  assert.doesNotMatch(skills({ CLAUDE_CONFIG_DIR: cfg }).message, /factory(,|$)/);
  assert.match(skills({}).message, /factory/);
  // An empty value falls back to ~/.claude.
  assert.match(skills({ CLAUDE_CONFIG_DIR: '' }).message, /factory/);
});

test('Claude session logs are read from CLAUDE_CONFIG_DIR', () => {
  const home = temp('cfg-home');
  const cfg = temp('cfg-dir');
  const input = { home, runId: 'r', sessions: [], from: 0, deadline: Date.now() + 5000 };
  assert.equal(readClaudeUsage({ ...input, env: { CLAUDE_CONFIG_DIR: cfg } }).problem, 'no Claude session logs found');
  mkdirSync(join(cfg, 'projects', '-slug'), { recursive: true });
  assert.notEqual(
    readClaudeUsage({ ...input, env: { CLAUDE_CONFIG_DIR: cfg } }).problem,
    'no Claude session logs found',
  );
});

test('an installed project-review Skill resolves under CLAUDE_CONFIG_DIR', () => {
  const home = temp('cfg-home');
  const cfg = temp('cfg-dir');
  const project = temp('cfg-project');
  mkdirSync(join(cfg, 'skills', 'review'), { recursive: true });
  writeFileSync(join(cfg, 'skills', 'review', 'SKILL.md'), 'review skill');
  mkdirSync(join(project, '.factory'));
  const review = {
    id: 'angular',
    name: 'Angular',
    mode: 'source',
    skill: { source: 'installed', name: 'review' },
    patterns: ['src/**/*.ts'],
  };
  writeFileSync(join(project, '.factory', 'reviews.json'), JSON.stringify({ reviews: [review] }));
  const load = (env) => () => loadProjectReviews(project, 'claude', home, env);
  assert.throws(load({}));
  assert.doesNotThrow(load({ CLAUDE_CONFIG_DIR: cfg }));
});
