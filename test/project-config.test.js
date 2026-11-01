import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, git } from './git-repo.js';

const cli = resolve('bin/tds-factory.js');
const invoke = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
const runFile = (cwd, id) => join(cwd, '.factory', 'runs', id, 'run.json');
const doctorConfig = (cwd) =>
  JSON.parse(invoke(cwd, 'doctor', '--json', '--agent', 'codex').stdout).agents[0].checks.find(
    (c) => c.id === 'config',
  );
function project(config) {
  const cwd = repo();
  mkdirSync(join(cwd, '.factory'), { recursive: true });
  if (config !== undefined)
    writeFileSync(
      join(cwd, '.factory/config.json'),
      typeof config === 'string' ? config : JSON.stringify(config, null, 2),
    );
  git(cwd, 'add', '-f', '.');
  git(cwd, 'commit', '-qm', 'config', '--allow-empty');
  return cwd;
}
const start = (cwd) => {
  const result = invoke(
    cwd,
    'run',
    'start',
    '--data',
    JSON.stringify({ title: 'Config', agent: 'codex', commands: 'true', conventions: [] }),
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

test('a Run freezes the project settings, so later edits do not change it', () => {
  const cwd = project({ models: { build: 'gpt-x' }, max_check_loops: 1, labels: { ticket: 'agent-ready' } });
  const id = start(cwd);
  writeFileSync(join(cwd, '.factory/config.json'), JSON.stringify({ max_check_loops: 3 }));
  assert.deepEqual(JSON.parse(invoke(cwd, 'run', 'config', '--id', id).stdout), {
    models: { build: 'gpt-x' },
    max_check_loops: 1,
    labels: { ticket: 'agent-ready' },
  });
});

test('a project without a config file gets the Factory defaults', () => {
  const cwd = project();
  const id = start(cwd);
  assert.deepEqual(JSON.parse(invoke(cwd, 'run', 'config', '--id', id).stdout), {
    models: {},
    max_check_loops: 4,
    labels: { ticket: 'ready-for-agent' },
  });
  assert.equal(doctorConfig(cwd).status, 'pass');
});

test('the project cap lowers the Check loop limit', () => {
  const cwd = project({ max_check_loops: 1 });
  const id = start(cwd);
  const record = JSON.parse(readFileSync(runFile(cwd, id), 'utf8'));
  writeFileSync(runFile(cwd, id), JSON.stringify({ ...record, stage: 'check', check_loops: 1 }));
  const refused = invoke(cwd, 'run', 'rework', '--id', id);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Check loop limit of 1/);
});

test('doctor names the line of each bad setting, and a cap above the Factory maximum is refused', () => {
  const text =
    '{\n  "models": {\n    "build": "gpt-x",\n    "deploy": "gpt-y"\n  },\n  "max_check_loops": 9,\n  "colour": true\n}\n';
  const result = doctorConfig(project(text));
  assert.equal(result.status, 'fail');
  assert.match(result.message, /line 4: unknown Stage "deploy"/);
  assert.match(result.message, /line 6: "max_check_loops" must be a whole number from 0 to 4/);
  assert.match(result.message, /line 7: unknown setting "colour"/);
  const broken = doctorConfig(project('{\n  "models": \n'));
  assert.equal(broken.status, 'fail');
  assert.match(broken.message, /invalid config\.json/);
  assert.notEqual(
    invoke(
      project(text),
      'run',
      'start',
      '--data',
      JSON.stringify({ title: 'x', agent: 'codex', commands: 'true', conventions: [] }),
    ).status,
    0,
  );
});

test('reviews in config.json join reviews.json, and an ID in both is a duplicate', () => {
  const review = {
    id: 'angular',
    name: 'Angular',
    mode: 'source',
    skill: { source: 'project', path: 'review/angular' },
  };
  const cwd = project({ reviews: [review] });
  mkdirSync(join(cwd, 'review/angular'), { recursive: true });
  writeFileSync(join(cwd, 'review/angular/SKILL.md'), 'Review');
  writeFileSync(join(cwd, '.factory/reviews.json'), JSON.stringify({ reviews: [{ ...review, id: 'legacy' }] }));
  git(cwd, 'add', '-f', '.');
  git(cwd, 'commit', '-qm', 'reviews');
  const id = start(cwd);
  assert.deepEqual(
    JSON.parse(readFileSync(runFile(cwd, id), 'utf8')).project_reviews.map((r) => r.id),
    ['legacy', 'angular'],
  );
  writeFileSync(join(cwd, '.factory/reviews.json'), JSON.stringify({ reviews: [review] }));
  const duplicate = doctorConfig(cwd);
  assert.equal(duplicate.status, 'fail');
  assert.match(duplicate.message, /line \d+: .*duplicate/);
});
