import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, git } from './git-repo.js';
import { SKILLS_DIR, AGENTS_DIR } from '../src/paths.js';
import { targets } from '../src/flow.js';

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
const doctor = (dir, ...args) => doctorAt(mkdtempSync(join(tmpdir(), 'doctor-home-')), dir, ...args);
function doctorAt(home, dir, ...args) {
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
  const noBullet = check(doctor(project('## Commands\n\n```powershell\n# Required after code changes\n.\\build.ps1\n```\n')).report, 'verify-command');
  assert.equal(noBullet.status, 'missing', 'a Commands section without a "- Verify:" line is missing, not an empty command');
  assert.match(noBullet.message, /- Verify:/);
  assert.equal(check(doctor(project('## Commands\n\n- Verify: ``\n')).report, 'verify-command').status, 'fail');
  assert.match(check(doctor(project('## Commands\n\n- Verify: `   `\n')).report, 'verify-command').message, /empty/);
  assert.match(check(doctor(project('## Commands\n\n- Verify: `npm\0 test`\n')).report, 'verify-command').message, /NUL/);
  const absent = check(doctor(project('## Commands\n\n- Verify: `no-such-tool-xyz test`\n')).report, 'verify-command');
  assert.equal(absent.status, 'fail');
  assert.match(absent.message, /was not found/);
  // The guide's plain form is accepted too.
  assert.match(check(doctor(project('## Commands\n\n- Verify: npm test\n')).report, 'verify-command').message, /npm test/);
  assert.equal(check(doctor(project('## Commands\n\n- Verify: npm test\n')).report, 'verify-command').status, 'pass');
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

// Installs the shipped Skills and Stage agents the way `install` lays them out, minus the ones named in `skip`.
function install(home, agent, skip = []) {
  const skills = join(home, targets[agent].global), agents = join(home, targets[agent].agents);
  mkdirSync(skills, { recursive: true });
  mkdirSync(agents, { recursive: true });
  for (const name of readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory() && !skip.includes(e.name)).map((e) => e.name)) cpSync(join(SKILLS_DIR, name), join(skills, name), { recursive: true });
  for (const file of readdirSync(join(AGENTS_DIR, agent)).filter((f) => !skip.includes(f.split('.')[0]))) cpSync(join(AGENTS_DIR, agent, file), join(agents, file));
}

test('doctor lists every required Skill that is not installed', () => {
  const none = check(doctor(project()).report, 'skills');
  assert.equal(none.status, 'fail');
  for (const name of ['factory', 'grill-with-docs', 'to-spec', 'to-tickets', 'implement-spec', 'tdd', 'code-review', 'security-scan', 'pr', 'unslop']) assert.ok(none.message.includes(name), name);
  const home = mkdtempSync(join(tmpdir(), 'doctor-home-'));
  install(home, 'claude', ['tdd']);
  assert.match(check(doctorAt(home, project()).report, 'skills').message, /: tdd$/);
});

test('doctor passes skills and review for every Agent target once the Factory is installed, globally or in the project', () => {
  for (const agent of Object.keys(targets)) {
    const home = mkdtempSync(join(tmpdir(), 'doctor-home-'));
    install(home, agent);
    const { report } = doctorAt(home, project(), '--agent', agent);
    assert.equal(check(report, 'skills').status, 'pass', agent);
    assert.equal(check(report, 'review').status, 'pass', agent);
  }
  const dir = project();
  install(dir, 'codex');
  assert.equal(check(doctor(dir, '--agent', 'codex').report, 'skills').status, 'pass');
});

test('doctor reports review as unavailable without the review Skills or the factory-check agent', () => {
  const skills = mkdtempSync(join(tmpdir(), 'doctor-home-'));
  install(skills, 'claude', ['code-review']);
  assert.match(check(doctorAt(skills, project()).report, 'review').message, /code-review/);
  const agent = mkdtempSync(join(tmpdir(), 'doctor-home-'));
  install(agent, 'claude', ['factory-check']);
  const review = check(doctorAt(agent, project()).report, 'review');
  assert.equal(review.status, 'fail');
  assert.match(review.message, /factory-check\.md/);
});

test('doctor does not read a conventions file that is not a regular file, or is huge', () => {
  const linked = project();
  rmSync(join(linked, 'AGENTS.md'));
  symlinkSync('/dev/zero', join(linked, 'AGENTS.md'));
  assert.equal(check(doctor(linked).report, 'tracker').status, 'missing');
  const huge = project('x'.repeat((1 << 20) + 1));
  const { status, report } = doctor(huge);
  assert.equal(status, 1);
  assert.match(check(report, 'tracker').message, /larger than 1 MiB/);
  assert.equal(report.checks.length, 6);
  // A link to a regular file is fine.
  const shared = project();
  rmSync(join(shared, 'AGENTS.md'));
  writeFileSync(join(shared, 'real.md'), AGENTS);
  symlinkSync('real.md', join(shared, 'AGENTS.md'));
  assert.equal(check(doctor(shared).report, 'verify-command').status, 'pass');
});

test('doctor text output does not pass terminal escapes through', () => {
  const dir = project('## Commands\n\n- Verify: `no-such-tool\u001b[2J`\n');
  const result = spawnSync(process.execPath, [cli, 'doctor'], { cwd: dir, encoding: 'utf8' });
  assert.doesNotMatch(result.stdout, /\u001b/);
});
