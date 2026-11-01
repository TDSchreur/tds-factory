import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
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

test('install writes the Stage and interactive review agents for each target', () => {
  for (const [agent, dir] of Object.entries(dirs)) {
    const project = mkdtempSync(join(tmpdir(), 'tds-agents-'));
    installIn(project, agent);
    const names = readdirSync(join(project, dir))
      .filter((f) => !f.startsWith('.'))
      .map((f) => f.split('.')[0])
      .sort();
    assert.deepEqual(
      names,
      [
        'factory-build',
        'factory-check',
        'factory-define',
        'factory-finish',
        'factory-follow-up',
        'factory-interactive-check',
      ],
      agent,
    );
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

test('the Build agent of every target follows the Exit checklist and records no verdict', () => {
  const sentence =
    'After the last Ticket and after every Rework, follow the Exit checklist in the Build instructions: the static checks, a term sweep, the required artifacts, a story trace and a security check in `build.md`, a hostile-input step, and one inline self-check of your own diff that records no verdict or Evidence.';
  for (const file of ['claude/factory-build.md', 'codex/factory-build.toml', 'copilot/factory-build.agent.md']) {
    assert.ok(readFileSync(join(AGENTS_DIR, file), 'utf8').includes(sentence), file);
  }
});

test('the Check agent of every target is read-only', () => {
  assert.match(readFileSync(join(AGENTS_DIR, 'claude', 'factory-check.md'), 'utf8'), /^tools: Read, Grep, Glob$/m);
  assert.match(
    readFileSync(join(AGENTS_DIR, 'copilot', 'factory-check.agent.md'), 'utf8'),
    /^tools: \["view", "grep", "glob"\]$/m,
  );
  assert.match(readFileSync(join(AGENTS_DIR, 'codex', 'factory-check.toml'), 'utf8'), /^sandbox_mode = "read-only"$/m);
});

test('install --agent all also writes the Copilot agents', () => {
  const project = mkdtempSync(join(tmpdir(), 'tds-agents-all-'));
  installIn(project, 'all');
  assert.equal(readdirSync(join(project, '.github', 'agents')).filter((f) => !f.startsWith('.')).length, 6);
});

test('install keeps a dangling agent symlink', () => {
  const project = mkdtempSync(join(tmpdir(), 'tds-agents-link-'));
  const dir = join(project, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  const link = join(dir, 'factory-build.md');
  symlinkSync(join(project, 'missing.md'), link);
  installIn(project, 'claude');
  assert.ok(lstatSync(link).isSymbolicLink());
});

test('install skips an installed skill edited by hand, unless forced', () => {
  const project = mkdtempSync(join(tmpdir(), 'tds-skill-edit-'));
  installIn(project, 'claude');
  const file = join(project, '.claude/skills/tdd/SKILL.md');
  const shipped = readFileSync(file, 'utf8');
  writeFileSync(file, 'my edit');
  installIn(project, 'claude');
  assert.equal(readFileSync(file, 'utf8'), 'my edit');
  installIn(project, 'claude', true);
  assert.equal(readFileSync(file, 'utf8'), shipped);
  installIn(project, 'claude');
  assert.equal(readFileSync(file, 'utf8'), shipped);
});

test('install --dry-run reports what it would do and writes nothing', () => {
  const project = mkdtempSync(join(tmpdir(), 'tds-dry-'));
  const log = mock.method(console, 'log', () => {});
  const cwd = process.cwd();
  process.chdir(project);
  try {
    install({ agent: 'claude', project: true, force: false, dryRun: true });
  } finally {
    process.chdir(cwd);
    log.mock.restore();
  }
  const lines = log.mock.calls.map((c) => c.arguments[0]);
  assert.ok(lines.some((l) => l.startsWith('would install claude/tdd')));
  assert.ok(lines.some((l) => l.startsWith('would install claude/factory-build')));
  assert.deepEqual(readdirSync(project), []);
});

test('install updates an unedited agent file but keeps an edited one', () => {
  const project = mkdtempSync(join(tmpdir(), 'tds-agents-update-'));
  installIn(project, 'claude');
  const dir = join(project, '.claude', 'agents');
  const record = join(dir, '.tds-factory-agents.json');
  const build = join(dir, 'factory-build.md');
  const define = join(dir, 'factory-define.md');
  // Simulate an older default for build, and a user edit for define.
  const old = readFileSync(build, 'utf8').replace('model: sonnet', 'model: old');
  writeFileSync(build, old);
  const rec = JSON.parse(readFileSync(record, 'utf8'));
  rec['factory-build.md'] = createHash('sha256').update(old).digest('hex');
  writeFileSync(record, JSON.stringify(rec));
  writeFileSync(define, 'model: mine\n');
  installIn(project, 'claude');
  assert.equal(readFileSync(build, 'utf8'), readFileSync(join(AGENTS_DIR, 'claude', 'factory-build.md'), 'utf8'));
  assert.equal(readFileSync(define, 'utf8'), 'model: mine\n');
});

test('the Skill and every Stage agent of every target state the follow-through rule', () => {
  const root = join(import.meta.dirname, '..');
  assert.match(
    readFileSync(join(root, 'skills', 'factory', 'SKILL.md'), 'utf8'),
    /Follow the Flow through: detailed instructions do not replace Define, never skip a Stage, never work around a refused transition or edit `run\.json` directly, and if something blocks a Stage, stop and tell the user/,
  );
  for (const dir of ['claude', 'codex', 'copilot']) {
    const files = readdirSync(join(root, 'agents', dir));
    assert.equal(files.length, 6, dir);
    for (const file of files)
      assert.match(
        readFileSync(join(root, 'agents', dir, file), 'utf8'),
        /Follow the Flow through: never skip a Stage or its reviewers, never work around a refused transition or edit `run\.json` directly, and if something blocks you, stop and tell the coordinator/,
        `${dir}/${file}`,
      );
  }
});
