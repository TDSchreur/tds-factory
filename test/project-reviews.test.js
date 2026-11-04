import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli, cliWith } from './cli-runner.js';
import { repo, git } from './git-repo.js';
import { openRunStore } from '../src/run-store.js';
import { metricsOf } from './run-view.js';

/** @import { Run } from '../src/run-record.js' */

/**
 * @param {string} cwd
 * @param {...string} args
 */
const invoke = async (cwd, ...args) => await cli(cwd, ...args);
/** @typedef {{ id: string, name: string, mode: string, skill: { source: string, path?: string, name?: string }, patterns: string[], runtime?: { start: string, ready: string, setup: string } }} ReviewConfig */
/** @typedef {{ verdict: string, inspected: string[], findings: { severity: string, description: string, location: string }[], evidence?: string[] }} ReviewReport */
/** @type {{ reviews: ReviewConfig[] }} */
const config = {
  reviews: [
    {
      id: 'angular',
      name: 'Angular',
      mode: 'source',
      skill: { source: 'project', path: 'review/angular' },
      patterns: ['src/**/*.ts'],
    },
  ],
};
/** @param {string} stdout What `doctor --json` printed. */
const reviewCheck = (stdout) => {
  /** @type {{ agents: { checks: { id: string, status: string, message: string }[] }[] }} */
  const report = JSON.parse(stdout);
  const check = report.agents[0].checks.find((c) => c.id === 'review');
  assert.ok(check, 'doctor reports a review check');
  return check;
};
/** @param {string} stdout What `run inspect --json` printed. */
const problemsOf = (stdout) => {
  /** @type {{ problems: { code: string }[] }[]} */
  const reports = JSON.parse(stdout);
  return reports[0].problems;
};
function setup() {
  const cwd = repo();
  git(cwd, 'config', 'user.name', 't');
  git(cwd, 'config', 'user.email', 't@t');
  mkdirSync(join(cwd, '.factory'), { recursive: true });
  mkdirSync(join(cwd, 'review/angular/references'), { recursive: true });
  writeFileSync(join(cwd, '.factory/reviews.json'), JSON.stringify(config));
  writeFileSync(join(cwd, 'review/angular/SKILL.md'), 'Review Angular v1');
  writeFileSync(join(cwd, 'review/angular/references/rules.md'), 'Rules v1');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'reviews');
  return cwd;
}
/** @param {string} cwd */
const start = async (cwd) =>
  await invoke(
    cwd,
    'run',
    'start',
    '--data',
    JSON.stringify({ title: 'Review', agent: 'codex', commands: 'true', conventions: [] }),
  );
/**
 * @param {string} cwd
 * @param {string} id
 */
const plan = async (cwd, id) => await invoke(cwd, 'run', 'reviews', '--id', id);

test('a Run freezes project review instructions and selects them from the whole diff', async () => {
  const cwd = setup();
  const created = await start(cwd);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.trim();
  const wt = JSON.parse(readFileSync(join(cwd, '.factory/runs', id, 'run.json'), 'utf8')).worktree;
  writeFileSync(join(cwd, 'review/angular/SKILL.md'), 'Review Angular v2');
  mkdirSync(join(wt, 'src/app'), { recursive: true });
  writeFileSync(join(wt, 'src/app/item.ts'), 'export {}');
  git(wt, 'add', '.');
  git(wt, 'commit', '-qm', 'change');
  const result = await plan(cwd, id);
  assert.equal(result.status, 0, result.stderr);
  const reviews = JSON.parse(result.stdout);
  assert.equal(reviews[0].id, 'angular');
  assert.equal(reviews[0].applicable, true);
  assert.equal(reviews[0].files['SKILL.md'], 'Review Angular v1');
  assert.equal(reviews[0].files['references/rules.md'], 'Rules v1');
});

test('Doctor rejects duplicate and reserved review IDs with an actionable error', async () => {
  const cwd = setup();
  for (const reviews of [[config.reviews[0], config.reviews[0]], [{ ...config.reviews[0], id: 'security' }]]) {
    writeFileSync(join(cwd, '.factory/reviews.json'), JSON.stringify({ reviews }));
    const result = await invoke(cwd, 'doctor', '--json', '--agent', 'codex');
    const review = reviewCheck(result.stdout);
    assert.equal(review.status, 'fail');
    assert.match(review.message, /review ID/);
  }
});

test('a deleted or renamed matching file triggers review and nonmatching changes explain skipping', async () => {
  const cwd = setup();
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src/old.ts'), 'old');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'old source');
  const created = await start(cwd);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.trim();
  const wt = JSON.parse(readFileSync(join(cwd, '.factory/runs', id, 'run.json'), 'utf8')).worktree;
  let reviews = JSON.parse((await plan(cwd, id)).stdout);
  assert.equal(reviews[0].applicable, false);
  assert.match(reviews[0].reason ?? '', /No changed file/);
  git(wt, 'mv', 'src/old.ts', 'src/old.txt');
  git(wt, 'commit', '-qm', 'rename');
  reviews = JSON.parse((await plan(cwd, id)).stdout);
  assert.equal(reviews[0].applicable, true);
  assert.deepEqual(reviews[0].matched, ['src/old.ts']);
});

test('Doctor fails when a referenced project Skill is missing', async () => {
  const cwd = setup();
  const changed = structuredClone(config);
  changed.reviews[0].skill.path = 'review/missing';
  writeFileSync(join(cwd, '.factory/reviews.json'), JSON.stringify(changed));
  const result = await invoke(cwd, 'doctor', '--json', '--agent', 'codex');
  const review = reviewCheck(result.stdout);
  assert.equal(review.status, 'fail');
  assert.match(review.message, /angular.*cannot load Skill/);
});

test('installed Skill contents are frozen per Run including bundled binary assets', async () => {
  const cwd = setup();
  const home = mkdtempSync(join(tmpdir(), 'review-home-'));
  mkdirSync(join(home, '.agents/skills/review'), { recursive: true });
  writeFileSync(join(home, '.agents/skills/review/SKILL.md'), 'installed version one');
  writeFileSync(join(home, '.agents/skills/review/asset.bin'), Buffer.from([0, 255, 1]));
  const changed = structuredClone(config);
  changed.reviews[0].skill = { source: 'installed', name: 'review' };
  writeFileSync(join(cwd, '.factory/reviews.json'), JSON.stringify(changed));
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'installed reference');
  const args = [
    'run',
    'start',
    '--data',
    JSON.stringify({ title: 'Review', agent: 'codex', commands: 'true', conventions: [] }),
  ];
  const result = await cliWith({ env: { ...process.env, HOME: home, USERPROFILE: home } }, cwd, ...args);
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(home, '.agents/skills/review/SKILL.md'), 'changed');
  const reviews = JSON.parse((await plan(cwd, result.stdout.trim())).stdout);
  assert.equal(reviews[0].files['SKILL.md'], 'installed version one');
  assert.deepEqual(Buffer.from(reviews[0].encoded_files['asset.bin'], 'base64'), Buffer.from([0, 255, 1]));
});

test('a required project review gates Finish and its evidence goes stale on new commits', async () => {
  const cwd = setup();
  const created = await start(cwd);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.trim();
  const wt = JSON.parse(readFileSync(join(cwd, '.factory/runs', id, 'run.json'), 'utf8')).worktree;
  /** @param {...string} args */
  const run = async (...args) => await invoke(cwd, 'run', ...args, '--id', id);
  assert.equal(
    (
      await run(
        'update',
        '--data',
        JSON.stringify({ spec_link: 'spec.md', tickets: ['1'], tickets_total: 1, tickets_done: 1 }),
      )
    ).status,
    0,
  );
  assert.equal((await run('transition', '--to', 'build')).status, 0);
  mkdirSync(join(wt, 'src'), { recursive: true });
  writeFileSync(join(wt, 'src/app.ts'), 'export {}');
  git(wt, 'add', '.');
  git(wt, 'commit', '-qm', 'app');
  assert.equal((await run('transition', '--to', 'check')).status, 0);
  assert.equal((await run('verify')).status, 0);
  for (const [axis, value] of [
    ['standards', 'pass'],
    ['spec', 'pass'],
    ['security', 'pass'],
    ['infrastructure', 'skipped'],
  ])
    assert.equal((await run('verdict', '--axis', axis, '--value', value)).status, 0);
  const missing = await run('transition', '--to', 'finish');
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /angular/);
  /** @type {ReviewReport} */
  const report = { verdict: 'pass', inspected: ['src/app.ts'], findings: [] };
  const result = await run('review', '--axis', 'angular', '--data', JSON.stringify(report));
  assert.equal(result.status, 0, result.stderr);
  git(wt, 'commit', '--allow-empty', '-qm', 'new commit');
  const stale = await run('transition', '--to', 'finish');
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /angular/);
});

/** @param {string} cwd */
async function checking(cwd, withChange = true) {
  const created = await start(cwd);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.trim();
  const wt = JSON.parse(readFileSync(join(cwd, '.factory/runs', id, 'run.json'), 'utf8')).worktree;
  /** @param {...string} args */
  const run = async (...args) => await invoke(cwd, 'run', ...args, '--id', id);
  assert.equal(
    (
      await run(
        'update',
        '--data',
        JSON.stringify({ spec_link: 'spec.md', tickets: ['1'], tickets_total: 1, tickets_done: 1 }),
      )
    ).status,
    0,
  );
  assert.equal((await run('transition', '--to', 'build')).status, 0);
  if (withChange) {
    mkdirSync(join(wt, 'src'), { recursive: true });
    writeFileSync(join(wt, 'src/app.ts'), 'export {}');
    git(wt, 'add', '.');
    git(wt, 'commit', '-qm', 'app');
  }
  assert.equal((await run('transition', '--to', 'check')).status, 0);
  return { id, wt, run };
}

test('only a nonmatching project review can skip and its reason is recorded', async () => {
  const cwd = setup(),
    { id, run } = await checking(cwd, false);
  assert.equal((await run('review', '--axis', 'angular', '--data', JSON.stringify({ verdict: 'skipped' }))).status, 0);
  const record = JSON.parse(readFileSync(join(cwd, '.factory/runs', id, 'run.json'), 'utf8'));
  assert.match(record.project_results.angular.reason ?? '', /No changed file/);
  const other = setup(),
    active = await checking(other);
  const result = await active.run('review', '--axis', 'angular', '--data', JSON.stringify({ verdict: 'skipped' }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot be skipped/);
});

test('medium findings cannot pass and Rework clears project review Evidence', async () => {
  const cwd = setup(),
    { id, run } = await checking(cwd);
  /** @type {ReviewReport} */
  const report = {
    verdict: 'pass',
    inspected: ['src/app.ts'],
    findings: [{ severity: 'MEDIUM', description: 'Missing label', location: 'src/app.ts' }],
  };
  assert.notEqual((await run('review', '--axis', 'angular', '--data', JSON.stringify(report))).status, 0);
  report.verdict = 'fail';
  assert.equal((await run('review', '--axis', 'angular', '--data', JSON.stringify(report))).status, 0);
  assert.equal((await run('rework')).status, 0);
  /** @type {Run} */
  const record = JSON.parse(readFileSync(join(cwd, '.factory/runs', id, 'run.json'), 'utf8'));
  assert.equal(record.project_results, undefined);
  assert.equal(record.check_loops, 1);
  assert.deepEqual(
    metricsOf(record).verdicts.map(({ axis, value, attempt, base_sha }) => ({ axis, value, attempt, base_sha })),
    [{ axis: 'angular', value: 'fail', attempt: 1, base_sha: record.base_sha }],
  );
});

test('interactive reviews require browser artifacts kept in the Run folder', async () => {
  const cwd = setup();
  const changed = structuredClone(config);
  changed.reviews[0].mode = 'interactive';
  changed.reviews[0].runtime = { start: 'npm start', ready: 'http://localhost:4200', setup: 'No account needed' };
  writeFileSync(join(cwd, '.factory/reviews.json'), JSON.stringify(changed));
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'interactive');
  const { id, run } = await checking(cwd);
  /** @type {ReviewReport} */
  const report = { verdict: 'pass', inspected: ['home screen'], findings: [] };
  let result = await run('review', '--axis', 'angular', '--data', JSON.stringify(report));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /browser evidence/);
  const dir = join(cwd, '.factory/runs', id, 'evidence');
  mkdirSync(dir);
  writeFileSync(join(dir, 'screen.png'), Buffer.from([1, 2, 3]));
  report.evidence = ['evidence/screen.png'];
  result = await run('review', '--axis', 'angular', '--data', JSON.stringify(report));
  assert.equal(result.status, 0, result.stderr);
  report.evidence = ['../escape.png'];
  assert.notEqual((await run('review', '--axis', 'angular', '--data', JSON.stringify(report))).status, 0);
});

test('a reviewer can materialize the original bundled Skill after the live Skill changes', async () => {
  const cwd = setup(),
    created = await start(cwd);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.trim();
  writeFileSync(join(cwd, 'review/angular/SKILL.md'), 'new content');
  const result = await invoke(cwd, 'run', 'materialize-review', '--id', id, '--axis', 'angular');
  assert.equal(result.status, 0, result.stderr);
  const dir = result.stdout.trim();
  assert.equal(readFileSync(join(dir, 'SKILL.md'), 'utf8'), 'Review Angular v1');
  assert.equal(readFileSync(join(dir, 'references/rules.md'), 'utf8'), 'Rules v1');
});

test('Run inspection reports stale project review Evidence after a new commit', async () => {
  const cwd = setup(),
    { run, wt } = await checking(cwd);
  assert.equal(
    (
      await run(
        'review',
        '--axis',
        'angular',
        '--data',
        JSON.stringify({ verdict: 'pass', inspected: ['src/app.ts'], findings: [] }),
      )
    ).status,
    0,
  );
  git(wt, 'commit', '--allow-empty', '-qm', 'new code');
  const result = await run('inspect', '--json');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(problemsOf(result.stdout).some((p) => p.code === 'stale-evidence'));
});

test('missing browser evidence prevents a clean Check after an interactive pass', async () => {
  const cwd = setup(),
    changed = structuredClone(config);
  changed.reviews[0].mode = 'interactive';
  changed.reviews[0].runtime = { start: 'npm start', ready: 'localhost:4200', setup: 'No account' };
  writeFileSync(join(cwd, '.factory/reviews.json'), JSON.stringify(changed));
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'interactive');
  const { id, run } = await checking(cwd);
  const dir = join(cwd, '.factory/runs', id, 'evidence');
  mkdirSync(dir);
  writeFileSync(join(dir, 'screen.png'), 'picture');
  const report = { verdict: 'pass', inspected: ['home'], findings: [], evidence: ['evidence/screen.png'] };
  assert.equal((await run('review', '--axis', 'angular', '--data', JSON.stringify(report))).status, 0);
  assert.equal((await run('verify')).status, 0);
  for (const [axis, value] of [
    ['standards', 'pass'],
    ['spec', 'pass'],
    ['security', 'pass'],
    ['infrastructure', 'skipped'],
  ])
    assert.equal((await run('verdict', '--axis', axis, '--value', value)).status, 0);
  rmSync(join(dir, 'screen.png'));
  const result = await run('transition', '--to', 'finish');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /angular.*evidence/i);
});

test('a passing required project review allows Finish after baseline and Verify pass', async () => {
  const cwd = setup(),
    { run } = await checking(cwd);
  assert.equal(
    (
      await run(
        'review',
        '--axis',
        'angular',
        '--data',
        JSON.stringify({ verdict: 'pass', inspected: ['src/app.ts'], findings: [] }),
      )
    ).status,
    0,
  );
  assert.equal((await run('verify')).status, 0);
  for (const [axis, value] of [
    ['standards', 'pass'],
    ['spec', 'pass'],
    ['security', 'pass'],
    ['infrastructure', 'skipped'],
  ])
    assert.equal((await run('verdict', '--axis', axis, '--value', value)).status, 0);
  const result = await run('transition', '--to', 'finish');
  assert.equal(result.status, 0, result.stderr);
});

test('sync clears project review Evidence when rebasing onto an advanced base', async () => {
  const cwd = setup(),
    { id, run } = await checking(cwd);
  /** @type {ReviewReport} */
  const report = { verdict: 'pass', inspected: ['src/app.ts'], findings: [] };
  assert.equal((await run('review', '--axis', 'angular', '--data', JSON.stringify(report))).status, 0);
  writeFileSync(join(cwd, 'other.txt'), 'change');
  git(cwd, 'add', 'other.txt');
  git(cwd, 'commit', '-qm', 'other change');
  const result = await run('sync');
  assert.equal(result.status, 0, result.stderr);
  /** @type {Run} */
  const record = JSON.parse(readFileSync(join(cwd, '.factory/runs', id, 'run.json'), 'utf8'));
  assert.equal(record.project_results, undefined);
  assert.equal(metricsOf(record).verdicts[0].axis, 'angular');
  assert.equal(metricsOf(record).verdicts[0].value, 'pass');
  assert.notEqual(metricsOf(record).verdicts[0].base_sha, record.base_sha);
  assert.equal(record.check_loops, 0);
});

test('sync invalidates skipped reviews when the recorded base changes without moving HEAD', async () => {
  const cwd = setup();
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src/app.ts'), 'original\n');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'original app');
  const created = await start(cwd);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.trim();
  const wt = JSON.parse(readFileSync(join(cwd, '.factory/runs', id, 'run.json'), 'utf8')).worktree;
  /** @param {...string} args */
  const run = async (...args) => await invoke(cwd, 'run', ...args, '--id', id);
  assert.equal(
    (
      await run(
        'update',
        '--data',
        JSON.stringify({ spec_link: 'spec.md', tickets: ['1'], tickets_total: 1, tickets_done: 1 }),
      )
    ).status,
    0,
  );
  assert.equal((await run('transition', '--to', 'build')).status, 0);
  writeFileSync(join(wt, 'src/app.ts'), 'temporary\n');
  git(wt, 'add', 'src/app.ts');
  git(wt, 'commit', '-qm', 'temporary app change');
  writeFileSync(join(wt, 'src/app.ts'), 'original\n');
  writeFileSync(join(wt, 'other.txt'), 'keep this commit\n');
  git(wt, 'add', '.');
  git(wt, 'commit', '-qm', 'restore app');
  assert.equal((await run('transition', '--to', 'check')).status, 0);
  writeFileSync(join(cwd, 'src/app.ts'), 'upstream\n');
  git(cwd, 'add', 'src/app.ts');
  git(cwd, 'commit', '-qm', 'upstream app change');
  const base = git(cwd, 'rev-parse', 'main');
  assert.notEqual((await run('sync')).status, 0, 'upstream change conflicts with the first Run commit');
  assert.throws(() => git(wt, 'rebase', base));
  writeFileSync(join(wt, 'src/app.ts'), 'temporary\n');
  git(wt, 'add', 'src/app.ts');
  git(wt, '-c', 'core.editor=true', 'rebase', '--continue');
  const head = git(wt, 'rev-parse', 'HEAD');
  assert.equal(
    JSON.parse((await plan(cwd, id)).stdout)[0].applicable,
    false,
    'the outdated recorded base hides the app change',
  );
  assert.equal((await run('review', '--axis', 'angular', '--data', JSON.stringify({ verdict: 'skipped' }))).status, 0);
  assert.equal((await run('verify')).status, 0);
  for (const [axis, value] of [
    ['standards', 'pass'],
    ['spec', 'pass'],
    ['security', 'pass'],
    ['infrastructure', 'skipped'],
  ])
    assert.equal((await run('verdict', '--axis', axis, '--value', value)).status, 0);
  assert.deepEqual(openRunStore(cwd).mergeEligibility(id).problems, []);
  const oldResult = JSON.parse(readFileSync(join(cwd, '.factory/runs', id, 'run.json'), 'utf8')).project_results
    .angular;
  const sync = await run('sync');
  assert.equal(sync.status, 0, sync.stderr);
  assert.equal(git(wt, 'rev-parse', 'HEAD'), head, 'the follow-up sync only updates the recorded base');
  assert.equal(JSON.parse((await plan(cwd, id)).stdout)[0].applicable, true, 'the app differs from the current base');
  const merge = openRunStore(cwd).mergeEligibility(id);
  assert.ok(
    merge.problems.some((p) => p.includes('angular')),
    JSON.stringify(merge.problems),
  );
  assert.notEqual(
    (await run('transition', '--to', 'finish')).status,
    0,
    'Finish must require a fresh applicable review',
  );
  const record = JSON.parse(readFileSync(join(cwd, '.factory/runs', id, 'run.json'), 'utf8'));
  assert.equal(record.base_sha, base);
  assert.equal(record.project_results, undefined);
  assert.equal(record.verify, undefined);
  // Simulate restoring an old result into a record that has a newer base.
  record.project_results = { angular: oldResult };
  writeFileSync(join(cwd, '.factory/runs', id, 'run.json'), JSON.stringify(record));
  assert.ok(
    openRunStore(cwd)
      .mergeEligibility(id)
      .problems.some((p) => /angular.*base/.test(p)),
  );
  const inspection = await run('inspect', '--json');
  assert.equal(inspection.status, 0, inspection.stderr);
  assert.ok(problemsOf(inspection.stdout).some((p) => p.code === 'stale-evidence'));
});

test('reviewPlan says so when the Run records no base commit', async () => {
  const { reviewPlan } = await import('../src/project-reviews.js');
  assert.throws(() => reviewPlan({ worktree: tmpdir(), project_reviews: [] }), /the Run records no base commit/);
});
