import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, git } from './git-repo.js';

const cli = resolve('bin/tds-factory.js');
const AGENTS = '# Agents\n\n## Agent skills\n\nsee docs\n\n## Commands\n\n- Verify: `npm test`\n';

// A ready project, with an empty home so no Skills are found unless a test installs them.
function project(agents = AGENTS) {
  const dir = repo();
  mkdirSync(join(dir, 'docs', 'agents'), { recursive: true });
  for (const f of ['issue-tracker.md', 'domain.md']) writeFileSync(join(dir, 'docs', 'agents', f), '# x\n');
  writeFileSync(join(dir, 'AGENTS.md'), agents);
  return dir;
}
function doctor(dir, ...args) {
  const home = mkdtempSync(join(tmpdir(), 'doctor-home-'));
  const result = spawnSync(process.execPath, [cli, 'doctor', '--json', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: home } });
  return { status: result.status, report: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}
const check = (report, id) => report.checks.find((c) => c.id === id);

test('doctor passes the project checks of a ready project and changes nothing', () => {
  const dir = project();
  const before = git(dir, 'status', '--porcelain');
  const { report } = doctor(dir);
  for (const id of ['cli', 'tracker', 'git', 'verify-command']) assert.equal(check(report, id).status, 'pass', id);
  assert.match(check(report, 'git').message, /main/);
  assert.equal(git(dir, 'status', '--porcelain'), before);
});

test('doctor names the missing tracker setup without naming a setup command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-bare-'));
  writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n');
  const { status, report } = doctor(dir);
  const tracker = check(report, 'tracker');
  assert.equal(tracker.status, 'missing');
  assert.match(tracker.message, /issue-tracker\.md/);
  assert.match(tracker.message, /Agent skills/);
  assert.doesNotMatch(tracker.message, /setup-matt-pocock-skills/);
  assert.equal(status, 1);
});

test('doctor fails the git check without a repository, a commit or an origin', () => {
  const plain = mkdtempSync(join(tmpdir(), 'doctor-plain-'));
  assert.match(check(doctor(plain).report, 'git').message, /not a git repository/);
  const noCommit = mkdtempSync(join(tmpdir(), 'doctor-nocommit-'));
  git(noCommit, 'init', '-q');
  assert.match(check(doctor(noCommit).report, 'git').message, /no commit/);
  const dir = project();
  git(dir, 'remote', 'remove', 'origin');
  const result = check(doctor(dir).report, 'git');
  assert.equal(result.status, 'fail');
  assert.match(result.message, /origin/);
});

test('doctor tells a missing Verify command from a malformed or unusable one', () => {
  assert.equal(check(doctor(project('# A\n\n## Agent skills\n')).report, 'verify-command').status, 'missing');
  assert.equal(check(doctor(project('## Commands\n\n- Verify: ``\n')).report, 'verify-command').status, 'fail');
  assert.match(check(doctor(project('## Commands\n\n- Verify: `   `\n')).report, 'verify-command').message, /empty/);
  assert.match(check(doctor(project('## Commands\n\n- Verify: `npm\0 test`\n')).report, 'verify-command').message, /NUL/);
  const absent = check(doctor(project('## Commands\n\n- Verify: `no-such-tool-xyz test`\n')).report, 'verify-command');
  assert.equal(absent.status, 'fail');
  assert.match(absent.message, /not on PATH/);
  // Shell syntax is not probed.
  assert.equal(check(doctor(project('## Commands\n\n- Verify: `cd app && no-such-tool-xyz`\n')).report, 'verify-command').status, 'pass');
});

test('doctor prints one line per check and exits non-zero while a check is not passing', () => {
  const dir = project('# A\n');
  const result = spawnSync(process.execPath, [cli, 'doctor'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^missing verify-command: /m);
  assert.match(result.stdout, /^pass +cli: /m);
});

test('doctor rejects an unknown Agent target', () => {
  assert.equal(doctor(project(), '--agent', 'nope').status, 1);
});
