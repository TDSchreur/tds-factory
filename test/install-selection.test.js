import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './git-repo.js';
import { planSelection } from '../src/install-selection.js';

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
  assert.deepEqual(plan.deselected, [{ agent: 'claude', configDir: missing }]);
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
