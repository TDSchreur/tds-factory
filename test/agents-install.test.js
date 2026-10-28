import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../src/install.js';
import { AGENTS_DIR } from '../src/paths.js';

function installIn(project, agent, force = false) {
  const log = mock.method(console, 'log', () => {});
  const warn = mock.method(console, 'warn', () => {});
  const cwd = process.cwd();
  process.chdir(project);
  try {
    install({ agent, project: true, force });
  } finally {
    process.chdir(cwd);
    log.mock.restore();
    warn.mock.restore();
  }
}

const dirs = { claude: '.claude/agents', codex: '.codex/agents', copilot: '.github/agents' };

test('install writes the four Stage agents for each target', () => {
  for (const [agent, dir] of Object.entries(dirs)) {
    const project = mkdtempSync(join(tmpdir(), 'tds-agents-'));
    installIn(project, agent);
    const names = readdirSync(join(project, dir)).map((f) => f.split('.')[0]).sort();
    assert.deepEqual(names, ['factory-build', 'factory-check', 'factory-define', 'factory-finish'], agent);
  }
});

test('install keeps an existing agent file you edited, unless forced', () => {
  const project = mkdtempSync(join(tmpdir(), 'tds-agents-keep-'));
  const file = join(project, '.claude', 'agents', 'factory-build.md');
  mkdirSync(join(project, '.claude', 'agents'), { recursive: true });
  writeFileSync(file, 'model: mine\n');
  installIn(project, 'claude');
  assert.equal(readFileSync(file, 'utf8'), 'model: mine\n');
  installIn(project, 'claude', true);
  assert.equal(readFileSync(file, 'utf8'), readFileSync(join(AGENTS_DIR, 'claude', 'factory-build.md'), 'utf8'));
});

test('the Check agent of every target is read-only', () => {
  assert.match(readFileSync(join(AGENTS_DIR, 'claude', 'factory-check.md'), 'utf8'), /^tools: Read, Grep, Glob$/m);
  assert.match(readFileSync(join(AGENTS_DIR, 'copilot', 'factory-check.agent.md'), 'utf8'), /^tools: \["view", "grep", "glob"\]$/m);
  assert.match(readFileSync(join(AGENTS_DIR, 'codex', 'factory-check.toml'), 'utf8'), /read-only/);
});
