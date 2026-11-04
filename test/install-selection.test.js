import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './git-repo.js';
import { planSelection, readSelection, saveSelection } from '../src/install-selection.js';

test('discovers separate Claude directories and does not preselect them', () => {
  const home = tempDir('selection-home-');
  fs.mkdirSync(path.join(home, '.claude'));
  fs.mkdirSync(path.join(home, '.claude-work'));
  const plan = planSelection({ home, cwd: home, env: {}, desired: [] });
  assert.deepEqual(plan.desired, []);
  assert.deepEqual(
    plan.candidates
      .filter((x) => x.agent === 'claude')
      .map((x) => x.configDir)
      .sort(),
    [path.join(home, '.claude'), path.join(home, '.claude-work')].sort(),
  );
  assert.ok(plan.candidates.some((x) => x.agent === 'codex'));
  assert.ok(plan.candidates.some((x) => x.agent === 'copilot'));
});

test('configured and custom Claude folders are candidates, and prior missing choices stay visible', () => {
  const home = tempDir('selection-home-');
  const configured = path.join(home, 'configured');
  const missing = path.join(home, 'unmounted');
  const plan = planSelection({
    home,
    cwd: home,
    env: { CLAUDE_CONFIG_DIR: 'configured' },
    custom: ['custom'],
    desired: [],
    previous: [{ agent: 'claude', configDir: missing }],
  });
  assert.ok(plan.candidates.some((item) => item.configDir === configured));
  assert.ok(plan.candidates.some((item) => item.configDir === path.join(home, 'custom')));
  assert.ok(plan.candidates.some((item) => item.configDir === missing));
  assert.deepEqual(plan.deselected, []);
  assert.deepEqual(plan.unavailable, [{ agent: 'claude', configDir: missing }]);
});

test('legacy ownership is reported without treating unrelated agent files as owned', () => {
  const home = tempDir('selection-home-');
  const skills = path.join(home, '.claude', 'skills', 'old');
  fs.mkdirSync(skills, { recursive: true });
  fs.writeFileSync(path.join(skills, '.tds-factory'), 'legacy');
  const plan = planSelection({ home, cwd: home, desired: [] });
  assert.equal(plan.candidates.find((x) => x.agent === 'claude')?.installed, true);
  assert.deepEqual(plan.desired, []);
});

test(
  'invalid selections and linked configured directories fail without touching targets',
  { skip: process.platform === 'win32' ? 'symlink creation requires Windows privileges' : false },
  () => {
    const home = tempDir('selection-home-');
    const outside = tempDir('selection-outside-');
    fs.symlinkSync(outside, path.join(home, 'linked'));
    assert.throws(() => planSelection({ home, cwd: home, custom: ['linked'], desired: [] }), /link/i);
    assert.throws(
      () => planSelection({ home, cwd: home, desired: [{ agent: /** @type {any} */ ('unknown') }] }),
      /agent/i,
    );
    assert.deepEqual(fs.readdirSync(outside), []);
  },
);

test('normalizes the default Claude destination and rejects conflicting skills paths', () => {
  const home = tempDir('selection-home-');
  const plan = planSelection({
    home,
    cwd: home,
    desired: [{ agent: 'claude' }, { agent: 'claude', configDir: '.claude' }],
  });
  assert.deepEqual(plan.desired, [{ agent: 'claude', configDir: path.join(home, '.claude') }]);
  assert.throws(() => planSelection({ home, cwd: home, custom: ['.agents'], desired: [] }), /conflict/i);
  assert.throws(() => planSelection({ home, cwd: home, custom: ['.codex'], desired: [] }), /conflict/i);
  assert.throws(
    () => planSelection({ home, cwd: home, custom: [path.join('.agents', 'skills')], desired: [] }),
    /conflict/i,
  );
});

test('project destinations do not discover global Claude folders', () => {
  const home = tempDir('selection-home-');
  const project = tempDir('selection-project-');
  fs.mkdirSync(path.join(home, '.claude-work'));
  const plan = planSelection({
    home,
    cwd: project,
    project: true,
    env: { CLAUDE_CONFIG_DIR: 'elsewhere' },
    desired: [{ agent: 'copilot' }],
  });
  assert.deepEqual(
    plan.candidates.map((item) => item.agent),
    ['claude', 'codex', 'copilot'],
  );
  assert.equal(
    plan.candidates.find((item) => item.agent === 'copilot')?.skillsDir,
    path.join(project, '.github/skills'),
  );
});

test('persists explicit selections separately and previews without writes', () => {
  const home = tempDir('selection-home-');
  const project = tempDir('selection-project-');
  fs.mkdirSync(path.join(home, '.claude-work'));
  const globalFile = path.join(home, 'config', 'selection.json');
  const projectFile = path.join(project, '.factory', 'selection.json');
  /** @type {import('../src/install-selection.js').Destination[]} */
  const chosen = [{ agent: 'claude', configDir: path.join(home, '.claude-work') }, { agent: 'codex' }];
  assert.equal(readSelection({ file: globalFile, home, cwd: home }), undefined);
  saveSelection({ trustedPaths: true, file: globalFile, home, cwd: home, selected: chosen });
  saveSelection({
    trustedPaths: true,
    file: projectFile,
    home,
    cwd: project,
    project: true,
    selected: [{ agent: 'copilot' }],
  });
  assert.deepEqual(readSelection({ file: globalFile, home, cwd: home }), chosen);
  assert.deepEqual(readSelection({ file: projectFile, home, cwd: project, project: true }), [{ agent: 'copilot' }]);
  const before = fs.readFileSync(globalFile, 'utf8');
  saveSelection({ trustedPaths: true, file: globalFile, home, cwd: home, selected: [], dryRun: true });
  assert.equal(fs.readFileSync(globalFile, 'utf8'), before);
});

test('invalid records and invalid new selections leave the existing record untouched', () => {
  const home = tempDir('selection-home-');
  const file = path.join(home, 'selection.json');
  for (const value of [
    '{',
    'null',
    JSON.stringify({ version: 2, selected: [] }),
    JSON.stringify({ version: 1, selected: [{ agent: 'claude' }] }),
    JSON.stringify({ version: 1, selected: [{ agent: 'claude', configDir: '../relative' }] }),
    JSON.stringify({ version: 1, selected: [{ agent: 'codex', extra: true }] }),
  ]) {
    fs.writeFileSync(file, value);
    assert.throws(() => readSelection({ file, home, cwd: home }), /record/);
    assert.throws(() => saveSelection({ trustedPaths: true, file, home, cwd: home, selected: [] }), /record/);
    assert.equal(fs.readFileSync(file, 'utf8'), value);
  }
});

test('a Claude selection without an explicit path uses the configured directory', () => {
  const home = tempDir('selection-home-');
  const result = planSelection({
    home,
    cwd: home,
    env: { CLAUDE_CONFIG_DIR: 'claude-config' },
    desired: [{ agent: 'claude' }],
  });
  assert.deepEqual(result.desired, [{ agent: 'claude', configDir: path.join(home, 'claude-config') }]);
});

test('an atomic replacement failure keeps the previous saved selection', () => {
  const home = tempDir('selection-home-');
  const file = path.join(home, 'selection.json');
  saveSelection({ trustedPaths: true, file, home, cwd: home, selected: [{ agent: 'codex' }] });
  const before = fs.readFileSync(file, 'utf8');
  const failure = mock.method(fs, 'renameSync', () => {
    throw new Error('write failed');
  });
  try {
    assert.throws(
      () => saveSelection({ trustedPaths: true, file, home, cwd: home, selected: [{ agent: 'copilot' }] }),
      /write failed/,
    );
  } finally {
    failure.mock.restore();
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(home), ['selection.json']);
});

test('does not drop a saved Claude destination while its directory is unavailable', () => {
  const home = tempDir('selection-home-');
  const configDir = path.join(home, '.claude-work');
  fs.mkdirSync(configDir);
  const file = path.join(home, 'selection.json');
  saveSelection({ trustedPaths: true, file, home, cwd: home, selected: [{ agent: 'claude', configDir }] });
  fs.rmdirSync(configDir);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => saveSelection({ trustedPaths: true, file, home, cwd: home, selected: [] }), /unavailable/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('rejects malformed legacy agent ownership records before accepting any evidence', () => {
  const home = tempDir('selection-home-');
  const agents = path.join(home, '.claude', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(path.join(agents, 'factory-build.md'), 'x');
  fs.writeFileSync(
    path.join(agents, '.tds-factory-agents.json'),
    JSON.stringify({ 'factory-build.md': '0'.repeat(64), 'C:outside': '0'.repeat(64) }),
  );
  assert.throws(() => planSelection({ home, cwd: home, desired: [] }), /record/);
});

test('explicit choices may select all three targets without a default selection', () => {
  const home = tempDir('selection-home-');
  const result = planSelection({
    home,
    cwd: home,
    desired: [{ agent: 'claude' }, { agent: 'codex' }, { agent: 'copilot' }],
  });
  assert.deepEqual(
    result.desired.map((item) => item.agent),
    ['claude', 'codex', 'copilot'],
  );
  assert.deepEqual(planSelection({ home, cwd: home, desired: [] }).desired, []);
});

test('rejects a destination path longer than the filesystem permits', () => {
  const home = tempDir('selection-home-');
  assert.throws(() => planSelection({ home, cwd: home, custom: ['x'.repeat(200_000)], desired: [] }));
  assert.deepEqual(fs.readdirSync(home), []);
});

test(
  'reports unreadable destination paths',
  {
    skip:
      process.platform === 'win32' || process.getuid?.() === 0
        ? 'POSIX permission checks require a non-root user'
        : false,
  },
  () => {
    const home = tempDir('selection-home-');
    const dir = path.join(home, '.claude');
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0);
    try {
      assert.throws(() => planSelection({ home, cwd: home, desired: [] }), /EACCES|permission/i);
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  },
);

test('record writes require the caller to establish a trusted filesystem path', () => {
  const home = tempDir('selection-home-');
  const file = path.join(home, 'selection.json');
  assert.throws(() => saveSelection({ file, home, cwd: home, selected: [] }), /trusted/);
  assert.equal(fs.existsSync(file), false);
});

test('saving an implicit Claude selection respects the configured directory', () => {
  const home = tempDir('selection-home-');
  const file = path.join(home, 'selection.json');
  saveSelection({
    file,
    home,
    cwd: home,
    env: { CLAUDE_CONFIG_DIR: 'work' },
    selected: [{ agent: 'claude' }],
    trustedPaths: true,
  });
  assert.deepEqual(readSelection({ file, home, cwd: home }), [{ agent: 'claude', configDir: path.join(home, 'work') }]);
});
