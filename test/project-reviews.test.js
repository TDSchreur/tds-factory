import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, git } from './git-repo.js';

const cli = resolve('bin/tds-factory.js');
const invoke = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
const config = { reviews: [{ id: 'angular', name: 'Angular', mode: 'source', skill: { source: 'project', path: 'review/angular' }, patterns: ['src/**/*.ts'] }] };
function setup() {
  const cwd = repo();
  mkdirSync(join(cwd, '.factory'), { recursive: true });
  mkdirSync(join(cwd, 'review/angular/references'), { recursive: true });
  writeFileSync(join(cwd, '.factory/reviews.json'), JSON.stringify(config));
  writeFileSync(join(cwd, 'review/angular/SKILL.md'), 'Review Angular v1');
  writeFileSync(join(cwd, 'review/angular/references/rules.md'), 'Rules v1');
  git(cwd, 'add', '.'); git(cwd, 'commit', '-qm', 'reviews');
  return cwd;
}
const start = cwd => invoke(cwd, 'run', 'start', '--data', JSON.stringify({ title: 'Review', agent: 'codex', commands: 'true', conventions: [] }));
const plan = (cwd, id) => invoke(cwd, 'run', 'reviews', '--id', id);

test('a Run freezes project review instructions and selects them from the whole diff', () => {
  const cwd = setup();
  const created = start(cwd); assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.trim();
  const wt = JSON.parse(readFileSync(join(cwd, '.factory/runs', id, 'run.json'))).worktree;
  writeFileSync(join(cwd, 'review/angular/SKILL.md'), 'Review Angular v2');
  mkdirSync(join(wt, 'src/app'), { recursive: true });
  writeFileSync(join(wt, 'src/app/item.ts'), 'export {}');
  git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'change');
  const result = plan(cwd, id); assert.equal(result.status, 0, result.stderr);
  const reviews = JSON.parse(result.stdout);
  assert.equal(reviews[0].id, 'angular');
  assert.equal(reviews[0].applicable, true);
  assert.equal(reviews[0].files['SKILL.md'], 'Review Angular v1');
  assert.equal(reviews[0].files['references/rules.md'], 'Rules v1');
});

test('Doctor rejects duplicate and reserved review IDs with an actionable error', () => {
  const cwd = setup();
  for (const reviews of [[config.reviews[0], config.reviews[0]], [{ ...config.reviews[0], id: 'security' }]]) {
    writeFileSync(join(cwd, '.factory/reviews.json'), JSON.stringify({ reviews }));
    const result = invoke(cwd, 'doctor', '--json', '--agent', 'codex');
    const review = JSON.parse(result.stdout).checks.find(check => check.id === 'review');
    assert.equal(review.status, 'fail');
    assert.match(review.message, /review ID/);
  }
});

test('a deleted or renamed matching file triggers review and nonmatching changes explain skipping', () => {
  const cwd = setup();
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src/old.ts'), 'old');
  git(cwd, 'add', '.'); git(cwd, 'commit', '-qm', 'old source');
  const created = start(cwd); assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.trim();
  const wt = JSON.parse(readFileSync(join(cwd, '.factory/runs', id, 'run.json'))).worktree;
  let reviews = JSON.parse(plan(cwd, id).stdout);
  assert.equal(reviews[0].applicable, false); assert.match(reviews[0].reason, /No changed file/);
  git(wt, 'mv', 'src/old.ts', 'src/old.txt'); git(wt, 'commit', '-qm', 'rename');
  reviews = JSON.parse(plan(cwd, id).stdout);
  assert.equal(reviews[0].applicable, true); assert.deepEqual(reviews[0].matched, ['src/old.ts']);
});

test('Doctor fails when a referenced project Skill is missing', () => {
  const cwd = setup();
  const changed = structuredClone(config); changed.reviews[0].skill.path = 'review/missing';
  writeFileSync(join(cwd, '.factory/reviews.json'), JSON.stringify(changed));
  const result = invoke(cwd, 'doctor', '--json', '--agent', 'codex');
  const review = JSON.parse(result.stdout).checks.find(check => check.id === 'review');
  assert.equal(review.status, 'fail'); assert.match(review.message, /angular.*cannot load Skill/);
});


test('installed Skill contents are frozen per Run including bundled binary assets', () => {
  const cwd = setup();
  const home = mkdtempSync(join(tmpdir(), 'review-home-'));
  mkdirSync(join(home, '.agents/skills/review'), { recursive: true });
  writeFileSync(join(home, '.agents/skills/review/SKILL.md'), 'installed version one');
  writeFileSync(join(home, '.agents/skills/review/asset.bin'), Buffer.from([0, 255, 1]));
  const changed = structuredClone(config); changed.reviews[0].skill = { source: 'installed', name: 'review' };
  writeFileSync(join(cwd, '.factory/reviews.json'), JSON.stringify(changed));
  git(cwd, 'add', '.'); git(cwd, 'commit', '-qm', 'installed reference');
  const args = ['run', 'start', '--data', JSON.stringify({ title: 'Review', agent: 'codex', commands: 'true', conventions: [] })];
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home } });
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(home, '.agents/skills/review/SKILL.md'), 'changed');
  const reviews = JSON.parse(plan(cwd, result.stdout.trim()).stdout);
  assert.equal(reviews[0].files['SKILL.md'], 'installed version one');
  assert.deepEqual(Buffer.from(reviews[0].encoded_files['asset.bin'], 'base64'), Buffer.from([0, 255, 1]));
});

test('a required project review gates Finish and its evidence goes stale on new commits', () => {
  const cwd = setup();
  const created = start(cwd); assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.trim();
  const wt = JSON.parse(readFileSync(join(cwd, '.factory/runs', id, 'run.json'))).worktree;
  const run = (...args) => invoke(cwd, 'run', ...args, '--id', id);
  assert.equal(run('update', '--data', JSON.stringify({ spec_link: 'spec.md', tickets: ['1'], tickets_total: 1, tickets_done: 1 })).status, 0);
  assert.equal(run('transition', '--to', 'build').status, 0);
  mkdirSync(join(wt, 'src'), { recursive: true }); writeFileSync(join(wt, 'src/app.ts'), 'export {}');
  git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'app');
  assert.equal(run('transition', '--to', 'check').status, 0);
  assert.equal(run('verify').status, 0);
  for (const [axis, value] of [['standards','pass'], ['spec','pass'], ['security','pass'], ['infrastructure','skipped']]) assert.equal(run('verdict', '--axis', axis, '--value', value).status, 0);
  const missing = run('transition', '--to', 'finish');
  assert.notEqual(missing.status, 0); assert.match(missing.stderr, /angular/);
  const report = { verdict: 'pass', inspected: ['src/app.ts'], findings: [] };
  const result = run('review', '--axis', 'angular', '--data', JSON.stringify(report)); assert.equal(result.status, 0, result.stderr);
  git(wt, 'commit', '--allow-empty', '-qm', 'new commit');
  const stale = run('transition', '--to', 'finish'); assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /angular/);
});

function checking(cwd, withChange = true) {
  const created = start(cwd); assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.trim();
  const wt = JSON.parse(readFileSync(join(cwd, '.factory/runs', id, 'run.json'))).worktree;
  const run = (...args) => invoke(cwd, 'run', ...args, '--id', id);
  assert.equal(run('update', '--data', JSON.stringify({ spec_link: 'spec.md', tickets: ['1'], tickets_total: 1, tickets_done: 1 })).status, 0);
  assert.equal(run('transition', '--to', 'build').status, 0);
  if (withChange) { mkdirSync(join(wt, 'src'), { recursive: true }); writeFileSync(join(wt, 'src/app.ts'), 'export {}'); git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'app'); }
  assert.equal(run('transition', '--to', 'check').status, 0);
  return { id, wt, run };
}

test('only a nonmatching project review can skip and its reason is recorded', () => {
  const cwd = setup(), { id, run } = checking(cwd, false);
  assert.equal(run('review', '--axis', 'angular', '--data', JSON.stringify({ verdict: 'skipped' })).status, 0);
  const record = JSON.parse(readFileSync(join(cwd, '.factory/runs', id, 'run.json')));
  assert.match(record.project_results.angular.reason, /No changed file/);
  const other = setup(), active = checking(other);
  const result = active.run('review', '--axis', 'angular', '--data', JSON.stringify({ verdict: 'skipped' }));
  assert.notEqual(result.status, 0); assert.match(result.stderr, /cannot be skipped/);
});

test('medium findings cannot pass and Rework clears project review Evidence', () => {
  const cwd = setup(), { id, run } = checking(cwd);
  const report = { verdict: 'pass', inspected: ['src/app.ts'], findings: [{ severity: 'MEDIUM', description: 'Missing label', location: 'src/app.ts' }] };
  assert.notEqual(run('review', '--axis', 'angular', '--data', JSON.stringify(report)).status, 0);
  report.verdict = 'fail'; assert.equal(run('review', '--axis', 'angular', '--data', JSON.stringify(report)).status, 0);
  assert.equal(run('rework').status, 0);
  const record = JSON.parse(readFileSync(join(cwd, '.factory/runs', id, 'run.json')));
  assert.equal(record.project_results, undefined); assert.equal(record.check_loops, 1);
});

test('interactive reviews require browser artifacts kept in the Run folder', () => {
  const cwd = setup();
  const changed = structuredClone(config);
  changed.reviews[0].mode = 'interactive';
  changed.reviews[0].runtime = { start: 'npm start', ready: 'http://localhost:4200', setup: 'No account needed' };
  writeFileSync(join(cwd, '.factory/reviews.json'), JSON.stringify(changed));
  git(cwd, 'add', '.'); git(cwd, 'commit', '-qm', 'interactive');
  const { id, run } = checking(cwd);
  const report = { verdict: 'pass', inspected: ['home screen'], findings: [] };
  let result = run('review', '--axis', 'angular', '--data', JSON.stringify(report));
  assert.notEqual(result.status, 0); assert.match(result.stderr, /browser evidence/);
  const dir = join(cwd, '.factory/runs', id, 'evidence'); mkdirSync(dir);
  writeFileSync(join(dir, 'screen.png'), Buffer.from([1, 2, 3]));
  report.evidence = ['evidence/screen.png'];
  result = run('review', '--axis', 'angular', '--data', JSON.stringify(report)); assert.equal(result.status, 0, result.stderr);
  report.evidence = ['../escape.png'];
  assert.notEqual(run('review', '--axis', 'angular', '--data', JSON.stringify(report)).status, 0);
});
