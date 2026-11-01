import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
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
// A shared check, else a check of an Agent target: the only one in the report, or Claude's in the default report.
const check = (report, id, agent = report.agents.length === 1 ? report.agents[0].id : 'claude') =>
  report.checks.find((c) => c.id === id) ?? report.agents.find((a) => a.id === agent)?.checks.find((c) => c.id === id);
const entry = (report, id) => report.agents.find((a) => a.id === id);
// A PATH holding only git, a fake npm (the Verify command) and the named agent commands, so the machine's own agents never count.
function pathWith(...commands) {
  const bin = mkdtempSync(join(tmpdir(), 'doctor-bin-'));
  for (const name of ['npm', ...commands]) writeFileSync(join(bin, name), '');
  const git = (process.env.PATH ?? '').split(delimiter).map((d) => join(d, 'git')).find((f) => existsSync(f));
  symlinkSync(git, join(bin, 'git'));
  return bin;
}
function doctorOn(path, dir, home, ...args) {
  const result = spawnSync(process.execPath, [cli, 'doctor', '--json', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: home ?? mkdtempSync(join(tmpdir(), 'doctor-home-')), PATH: path } });
  return { status: result.status, report: result.stdout ? JSON.parse(result.stdout) : null, stdout: result.stdout };
}

test('doctor passes the project checks of a ready project and changes nothing', () => {
  const dir = project();
  const before = git(dir, 'status', '--porcelain');
  const { report } = doctor(dir);
  for (const id of ['cli', 'tracker', 'git', 'verify-command']) assert.equal(check(report, id).status, 'pass', id);
  assert.match(check(report, 'git').message, /main/);
  assert.equal(git(dir, 'status', '--porcelain'), before);
});

test('doctor discovers the project from a nested directory', () => {
  const dir = project(`${AGENTS}- Verify-fast: \`npm run test:unit\`\n`);
  const nested = join(dir, 'deep', 'nested');
  mkdirSync(nested, { recursive: true });
  install(dir, 'codex');
  const home = mkdtempSync(join(tmpdir(), 'doctor-home-'));
  const root = doctorAt(home, dir, '--agent', 'codex');
  const child = doctorAt(home, nested, '--agent', 'codex');
  assert.deepEqual(child, root);
});

test('doctor uses the linked worktree rather than the main checkout', () => {
  const main = repo();
  const linked = join(mkdtempSync(join(tmpdir(), 'doctor-worktree-')), 'linked');
  git(main, 'worktree', 'add', '-b', 'doctor-test', linked);
  mkdirSync(join(linked, 'docs', 'agents'), { recursive: true });
  for (const f of ['issue-tracker.md', 'domain.md']) writeFileSync(join(linked, 'docs', 'agents', f), '# x\n');
  writeFileSync(join(linked, 'AGENTS.md'), AGENTS);
  const nested = join(linked, 'nested');
  mkdirSync(nested);
  const home = mkdtempSync(join(tmpdir(), 'doctor-home-'));
  assert.deepEqual(doctorAt(home, nested, '--agent', 'codex'), doctorAt(home, linked, '--agent', 'codex'));
  assert.equal(check(doctorAt(home, nested, '--agent', 'codex').report, 'tracker').status, 'pass');
});

test('doctor preserves spaces at the end of the worktree path', () => {
  const main = repo();
  const linked = join(mkdtempSync(join(tmpdir(), 'doctor-space-')), 'project ');
  git(main, 'worktree', 'add', '-b', 'doctor-space', linked);
  mkdirSync(join(linked, 'docs', 'agents'), { recursive: true });
  for (const f of ['issue-tracker.md', 'domain.md']) writeFileSync(join(linked, 'docs', 'agents', f), '# x\n');
  writeFileSync(join(linked, 'AGENTS.md'), AGENTS);
  const nested = join(linked, 'nested');
  mkdirSync(nested);
  assert.equal(check(doctor(nested, '--agent', 'codex').report, 'tracker').status, 'pass');
});

test('doctor preserves a trailing carriage return in a POSIX worktree path', { skip: process.platform === 'win32' }, () => {
  const main = repo();
  const linked = join(mkdtempSync(join(tmpdir(), 'doctor-cr-')), 'project\r');
  git(main, 'worktree', 'add', '-b', 'doctor-cr', linked);
  mkdirSync(join(linked, 'docs', 'agents'), { recursive: true });
  for (const f of ['issue-tracker.md', 'domain.md']) writeFileSync(join(linked, 'docs', 'agents', f), '# x\n');
  writeFileSync(join(linked, 'AGENTS.md'), AGENTS);
  assert.equal(check(doctor(linked, '--agent', 'codex').report, 'tracker').status, 'pass');
});

test('doctor tells a user outside Git why it cannot pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-outside-'));
  const result = spawnSync(process.execPath, [cli, 'doctor'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /fail +git: not a git repository/);
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

test('doctor prints one line per check and exits non-zero when a shared check is not pass or no agent is usable', () => {
  const dir = project('# A\n');
  const result = spawnSync(process.execPath, [cli, 'doctor'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^missing verify-command: /m);
  assert.match(result.stdout, /^pass +cli: /m);
});

test('doctor rejects an unknown Agent target and lists the valid ones', () => {
  const result = doctor(project(), '--agent', 'nope');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /claude, codex, copilot/);
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

test('doctor for Copilot finds Skills in the Claude and Codex folders, where the default install puts them', () => {
  for (const skillsFrom of ['claude', 'codex']) {
    const home = mkdtempSync(join(tmpdir(), 'doctor-home-'));
    install(home, skillsFrom);
    install(home, 'copilot'); // Copilot's own folders hold the Stage agents, not the Skills
    rmSync(join(home, targets.copilot.global), { recursive: true, force: true });
    const { report } = doctorAt(home, project(), '--agent', 'copilot');
    assert.equal(check(report, 'skills').status, 'pass', skillsFrom);
    assert.equal(check(report, 'review').status, 'pass', skillsFrom);
  }
});

test('doctor for Copilot also finds Skills in the project Claude and Codex folders', () => {
  for (const skillsFrom of ['claude', 'codex']) {
    const dir = project(), home = mkdtempSync(join(tmpdir(), 'doctor-home-'));
    install(dir, skillsFrom);
    install(home, 'copilot');
    rmSync(join(home, targets.copilot.global), { recursive: true, force: true });
    const { report } = doctorAt(home, dir, '--agent', 'copilot');
    assert.equal(check(report, 'skills').status, 'pass', skillsFrom);
    assert.equal(check(report, 'review').status, 'pass', skillsFrom);
  }
});

test('doctor for Claude and Codex ignores Skills that are only in another Agent target folder', () => {
  const home = mkdtempSync(join(tmpdir(), 'doctor-home-'));
  install(home, 'claude');
  install(home, 'codex');
  install(home, 'copilot');
  rmSync(join(home, targets.copilot.agents), { recursive: true, force: true });
  rmSync(join(home, targets.claude.global), { recursive: true, force: true });
  rmSync(join(home, targets.codex.global), { recursive: true, force: true });
  // Skills now exist only in the Copilot folder, so Claude and Codex must still report them missing.
  for (const agent of ['claude', 'codex']) assert.equal(check(doctorAt(home, project(), '--agent', agent).report, 'skills').status, 'fail', agent);
  // And the Copilot folder alone does satisfy Copilot itself.
  assert.equal(check(doctorAt(home, project(), '--agent', 'copilot').report, 'skills').status, 'pass');
  const other = mkdtempSync(join(tmpdir(), 'doctor-home-'));
  install(other, 'claude');
  assert.equal(check(doctorAt(other, project(), '--agent', 'codex').report, 'skills').status, 'fail');
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
  assert.equal(report.checks.filter((c) => c.id !== 'agents').length, 6);
  for (const a of report.agents) assert.equal(a.checks.length, 4, a.id);
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

test('doctor notes merged Runs that still hold a worktree or branch, without failing', async () => {
  const { doctor: run } = await import('../src/doctor.js');
  const { openRunStore } = await import('../src/run-store.js');
  const dir = project();
  git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'project');
  const store = openRunStore(dir);
  const merged = store.start({ title: 'Merged', agent: 'claude', commands: 'npm test', conventions: [] });
  const open = store.start({ title: 'Open', agent: 'claude', commands: 'npm test', conventions: [] });
  store.update(merged, { pr: 'https://github.com/o/r/pull/1' });
  const file = join(dir, '.factory', 'runs', merged, 'run.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), status: 'done' }));
  store.update(open, { pr: 'https://github.com/o/r/pull/2' });
  const home = mkdtempSync(join(tmpdir(), 'doctor-home-'));
  const head = git(join(dir, '.factory', 'worktrees', merged), 'rev-parse', 'HEAD');
  const prState = (url) => ({ state: url.endsWith('/1') ? 'MERGED' : 'OPEN', head });
  const before = run({ projectDir: dir, homeDir: home, prState });
  assert.equal(before.notes.length, 1);
  assert.match(before.notes[0], new RegExp(merged));
  assert.match(before.notes[0], /tds-factory run clean --all/);
  assert.ok(!before.notes[0].includes(open));
  const going = store.start({ title: 'Going', agent: 'claude', commands: 'npm test', conventions: [] });
  store.update(going, { pr: 'https://github.com/o/r/pull/1' });
  assert.ok(!run({ projectDir: dir, homeDir: home, prState }).notes[0].includes(going), 'a Run that is not done is not named: clean would keep it');
  assert.equal(before.ok, run({ projectDir: dir, homeDir: home, prState: () => undefined }).ok, 'notes do not change ok');
  store.clean(merged, { prState });
  assert.deepEqual(run({ projectDir: dir, homeDir: home, prState }).notes, []);
});

test('Doctor requires an interactive review agent when an interactive project review is configured', () => {
  const home = mkdtempSync(join(tmpdir(), 'doctor-home-'));
  install(home, 'codex', ['factory-interactive-check']);
  const dir = project();
  mkdirSync(join(dir, '.factory'), { recursive: true });
  mkdirSync(join(dir, 'review'), { recursive: true });
  writeFileSync(join(dir, 'review', 'SKILL.md'), 'Review UX');
  writeFileSync(join(dir, '.factory', 'reviews.json'), JSON.stringify({ reviews: [{ id: 'ux', name: 'UX', mode: 'interactive', skill: { source: 'project', path: 'review' }, runtime: { start: 'npm start', ready: 'localhost:4200', setup: 'No account' } }] }));
  const unavailable = check(doctorAt(home, dir, '--agent', 'codex').report, 'review');
  assert.equal(unavailable.status, 'fail'); assert.match(unavailable.message, /factory-interactive-check/);
  install(home, 'codex');
  assert.equal(check(doctorAt(home, dir, '--agent', 'codex').report, 'review').status, 'pass');
});

test('doctor reports claude, codex and copilot in that order by default, shared checks once', () => {
  const { report } = doctorOn(pathWith('claude'), project());
  assert.deepEqual(report.agents.map((a) => a.id), ['claude', 'codex', 'copilot']);
  assert.deepEqual(report.checks.map((c) => c.id).filter((id) => id !== 'agents'), ['cli', 'tracker', 'git', 'verify-command', 'verify-fast', 'guides']);
  for (const a of report.agents) assert.deepEqual(a.checks.map((c) => c.id), ['binary', 'skills', 'config', 'review'], a.id);
});

test('a missing agent binary is missing, never fail, and a usable agent keeps the report ok', () => {
  const home = mkdtempSync(join(tmpdir(), 'doctor-home-'));
  install(home, 'codex');
  const { report, status } = doctorOn(pathWith('codex'), project(), home);
  assert.equal(entry(report, 'codex').usable, true);
  assert.equal(entry(report, 'claude').usable, false);
  assert.equal(check(report, 'binary', 'claude').status, 'missing');
  assert.equal(check(report, 'binary', 'copilot').status, 'missing');
  assert.equal(check(report, 'skills', 'claude').status, 'fail', 'a line of an agent that is not usable stays visible');
  assert.equal(report.ok, true);
  assert.equal(status, 0);
});

test('an agent whose command is on PATH but whose Skills are missing is not usable', () => {
  const { report } = doctorOn(pathWith('claude'), project());
  assert.equal(check(report, 'binary', 'claude').status, 'pass');
  assert.equal(check(report, 'skills', 'claude').status, 'fail');
  assert.equal(entry(report, 'claude').usable, false);
});

test('doctor fails when no agent is usable and says what to do', () => {
  const { report, status } = doctorOn(pathWith(), project());
  assert.equal(report.ok, false);
  assert.equal(status, 1);
  const line = report.checks.find((c) => c.id === 'agents');
  assert.equal(line.status, 'fail');
  assert.equal(line.message, 'no agent is usable: install claude, codex or copilot and run tds-factory install');
  const text = spawnSync(process.execPath, [cli, 'doctor'], { cwd: project(), encoding: 'utf8', env: { ...process.env, PATH: pathWith() } });
  assert.match(text.stdout, /^fail +agents: no agent is usable/m);
});

test('doctor fails when a shared check fails even though an agent is usable', () => {
  const home = mkdtempSync(join(tmpdir(), 'doctor-home-'));
  install(home, 'claude');
  const { report, status } = doctorOn(pathWith('claude'), project('# A\n'), home);
  assert.equal(entry(report, 'claude').usable, true);
  assert.equal(report.ok, false);
  assert.equal(status, 1);
});

test('doctor --agent reports only that agent and ignores its missing binary', () => {
  const home = mkdtempSync(join(tmpdir(), 'doctor-home-'));
  install(home, 'copilot');
  const { report, status } = doctorOn(pathWith(), project(), home, '--agent', 'copilot');
  assert.deepEqual(report.agents.map((a) => a.id), ['copilot']);
  assert.equal(check(report, 'binary').status, 'missing', 'shown');
  assert.equal(report.ok, true, 'but not counted');
  assert.equal(status, 0);
  assert.equal(report.checks.some((c) => c.id === 'agents'), false);
});

test('doctor --agent still needs that agent Skills, review and config to pass', () => {
  const { report, status } = doctorOn(pathWith('codex'), project(), undefined, '--agent', 'codex');
  assert.equal(check(report, 'skills').status, 'fail');
  assert.equal(report.ok, false);
  assert.equal(status, 1);
});

test('doctor text output groups the checks under each agent', () => {
  const result = spawnSync(process.execPath, [cli, 'doctor'], { cwd: project(), encoding: 'utf8', env: { ...process.env, PATH: pathWith('codex') } });
  for (const id of ['claude', 'codex', 'copilot']) assert.match(result.stdout, new RegExp(`^${id}: (not )?usable$`, 'm'), id);
  assert.match(result.stdout, /^ +pass +binary: codex/m);
  assert.match(result.stdout, /^ +missing +binary: claude/m);
});

test('on Windows the agent command is found with a PATHEXT extension', async () => {
  const { doctor: run } = await import('../src/doctor.js');
  const bin = mkdtempSync(join(tmpdir(), 'doctor-bin-')), dir = project();
  writeFileSync(join(bin, 'claude.cmd'), '');
  const saved = { path: process.env.PATH, ext: process.env.PATHEXT, platform: Object.getOwnPropertyDescriptor(process, 'platform') };
  try {
    process.env.PATH = bin; process.env.PATHEXT = '.EXE;.cmd';
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const binary = (agent) => run({ projectDir: dir, agent, homeDir: mkdtempSync(join(tmpdir(), 'doctor-home-')) }).agents[0].checks.find((c) => c.id === 'binary').status;
    assert.equal(binary('claude'), 'pass');
    assert.equal(binary('codex'), 'missing');
    Object.defineProperty(process, 'platform', saved.platform);
    assert.equal(binary('claude'), 'missing', 'without Windows the extension is not tried');
  } finally {
    Object.defineProperty(process, 'platform', saved.platform);
    if (saved.path === undefined) delete process.env.PATH; else process.env.PATH = saved.path;
    if (saved.ext === undefined) delete process.env.PATHEXT; else process.env.PATHEXT = saved.ext;
  }
});

test('doctor reports the optional Verify-fast command like the Verify command', () => {
  const project_ = (line) => project(`## Agent skills\n\nsee docs\n\n## Commands\n\n- Verify: \`npm test\`\n${line}`);
  const none = check(doctor(project_('')).report, 'verify-fast');
  assert.equal(none.status, 'pass');
  assert.match(none.message, /no Verify-fast command/);
  const set = check(doctor(project_('- Verify-fast: `npm run test:unit`\n')).report, 'verify-fast');
  assert.equal(set.status, 'pass');
  assert.match(set.message, /Verify-fast command: npm run test:unit/);
  const missing = check(doctor(project_('- Verify-fast: `no-such-tool-xyz --quick`\n')).report, 'verify-fast');
  assert.equal(missing.status, 'fail');
  assert.match(missing.message, /no-such-tool-xyz.*not found/);
  // An unusable optional command is shown but never fails the report.
  const home = mkdtempSync(join(tmpdir(), 'doctor-home-'));
  install(home, 'claude');
  const shown = doctorOn(pathWith('claude'), project_('- Verify-fast: `no-such-tool-xyz --quick`\n'), home);
  assert.equal(check(shown.report, 'verify-fast').status, 'fail');
  assert.equal(shown.report.ok, true);
  assert.equal(shown.status, 0);
  // The full Verify line is still the one `verify-command` reads.
  assert.match(check(doctor(project_('- Verify-fast: `npm run test:unit`\n')).report, 'verify-command').message, /Verify command: npm test$/);
});

test('doctor fails the skills check when the installed factory Skill lacks its reference files', () => {
  const home = mkdtempSync(join(tmpdir(), 'doctor-home-'));
  install(home, 'claude');
  assert.equal(check(doctorAt(home, project(), '--agent', 'claude').report, 'skills').status, 'pass');
  rmSync(join(home, targets.claude.global, 'factory', 'references', 'check.md'));
  const skills = check(doctorAt(home, project(), '--agent', 'claude').report, 'skills');
  assert.equal(skills.status, 'fail');
  assert.match(skills.message, /factory Skill is missing its reference files: check\.md/);
  assert.match(skills.message, /tds-factory install/);
});
