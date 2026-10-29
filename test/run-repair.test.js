import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync as fsLstat, mkdtempSync, readFileSync, rmSync, symlinkSync as fsSymlink, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { git, repo } from './git-repo.js';
import { openRunStore } from '../src/run-store.js';

const cli = resolve('bin/tds-factory.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });
const start = (cwd) => {
  const result = run(cwd, 'start', '--data', JSON.stringify({ title: 'Recover', agent: 'codex', commands: 'true', conventions: [] }));
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const recordPath = (cwd, id) => join(cwd, '.factory', 'runs', id, 'run.json');
const lockPath = (cwd, id) => join(cwd, '.factory', 'runs', `.lock-${createHash('sha256').update(id).digest('hex')}`);
const repair = (cwd, id, ...args) => run(cwd, 'repair', '--id', id, ...args);

test('repair proposes and then reconstructs a dirty orphan without repeating work', () => {
  const cwd = repo(), id = start(cwd), path = recordPath(cwd, id);
  const worktree = JSON.parse(readFileSync(path, 'utf8')).worktree;
  writeFileSync(join(worktree, 'unfinished'), 'keep this');
  rmSync(join(cwd, '.factory', 'runs', id), { recursive: true });
  const inspect = run(cwd, 'inspect', '--id', id, '--json');
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.ok(JSON.parse(inspect.stdout)[0].problems.some((p) => p.code === 'orphan'));
  const before = git(cwd, 'rev-parse', id);
  const plan = repair(cwd, id);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /recreate|reconstruct/i);
  assert.equal(existsSync(path), false);
  assert.equal(repair(cwd, id, '--apply').status, 0);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(record.status, 'interrupted');
  assert.equal(record.worktree, worktree);
  assert.equal(record.stage, 'define');
  assert.equal(record.commands, '');
  assert.equal(record.verify, undefined);
  assert.equal(git(cwd, 'rev-parse', id), before);
  assert.equal(readFileSync(join(worktree, 'unfinished'), 'utf8'), 'keep this');
});

test('repair never removes a lock by age and only applies a dead local owner', () => {
  const cwd = repo(), id = start(cwd), lock = lockPath(cwd, id);
  const old = { pid: process.pid, host: hostname(), started: '2000-01-01T00:00:00.000Z' };
  for (const value of [JSON.stringify(old), JSON.stringify({ ...old, host: 'another-host' }), '', '{broken']) {
    writeFileSync(lock, value);
    assert.notEqual(repair(cwd, id, '--apply').status, 0);
    assert.equal(readFileSync(lock, 'utf8'), value);
  }
  const dead = JSON.stringify({ ...old, pid: 2147483647 });
  writeFileSync(lock, dead);
  const plan = repair(cwd, id);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /dead/);
  assert.equal(readFileSync(lock, 'utf8'), dead);
  const applied = repair(cwd, id, '--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(existsSync(lock), false);
  assert.equal(repair(cwd, id, '--apply').status, 0);
});

test('repair preserves corrupt records and refuses mismatched worktree branches', () => {
  const cwd = repo(), id = start(cwd), path = recordPath(cwd, id);
  writeFileSync(path, '{broken');
  assert.notEqual(repair(cwd, id, '--apply').status, 0);
  assert.equal(readFileSync(path, 'utf8'), '{broken');
  rmSync(path);
  const wt = join(cwd, '.factory', 'worktrees', id);
  git(wt, 'switch', '-q', '-c', 'some-other-branch');
  assert.notEqual(repair(cwd, id, '--apply').status, 0);
  assert.equal(existsSync(path), false);
});


test('repair reconciles the exact GitHub repository and existing PR before adopting it', () => {
  const cwd = repo(), id = start(cwd), file = recordPath(cwd, id);
  git(cwd, 'remote', 'set-url', 'origin', 'https://github.com/example/project.git');
  const tools = mkdtempSync(join(tmpdir(), 'repair-gh-'));
  const gh = join(tools, 'gh'), calls = join(tools, 'calls');
  const pr = { url: 'https://github.com/example/project/pull/123', headRefName: id, headRepositoryOwner: { login: 'example' }, headRepository: { name: 'project' } };
  writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\nprintf '%s\\n' '${JSON.stringify([pr])}'\n`);
  chmodSync(gh, 0o755);
  const invoke = (...args) => spawnSync(process.execPath, [cli, 'run', 'repair', '--id', id, ...args], { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${tools}:${process.env.PATH}` } });
  const plan = invoke();
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /adopt existing PR/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pr, undefined);
  const applied = invoke('--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pr, pr.url);
  assert.match(readFileSync(calls, 'utf8'), new RegExp(`pr list --repo example/project --head ${id} --state all`));
  assert.equal(invoke('--apply').status, 0);
});


test('ambiguous, unavailable, and conflicting GitHub results do not rewrite a PR link', () => {
  const cwd = repo(), id = start(cwd), file = recordPath(cwd, id);
  git(cwd, 'remote', 'set-url', 'origin', 'https://github.com/example/project.git');
  const tools = mkdtempSync(join(tmpdir(), 'repair-gh-')), gh = join(tools, 'gh');
  const pr = (n) => ({ url: `https://github.com/example/project/pull/${n}`, headRefName: id, headRepositoryOwner: { login: 'example' }, headRepository: { name: 'project' } });
  const fixture = (data) => { writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(data)}'\n`); chmodSync(gh, 0o755); };
  const invoke = (...args) => spawnSync(process.execPath, [cli, 'run', 'repair', '--id', id, ...args], { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${tools}:${process.env.PATH}` } });
  fixture([pr(1), pr(2)]);
  assert.match(invoke('--apply').stdout, /ambiguous/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pr, undefined);
  writeFileSync(gh, '#!/bin/sh\nexit 1\n'); chmodSync(gh, 0o755);
  assert.match(invoke('--apply').stdout, /unavailable/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pr, undefined);
  const record = JSON.parse(readFileSync(file, 'utf8')); record.pr = 'https://github.com/example/project/pull/99'; writeFileSync(file, JSON.stringify(record));
  fixture([pr(1)]);
  assert.match(invoke('--apply').stdout, /conflicts/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pr, record.pr);
});

test('dangling lock symlinks and incomplete GitHub responses remain unresolved', () => {
  const cwd = repo(), id = start(cwd), lock = lockPath(cwd, id);
  const target = join(cwd, 'missing-lock-target');
  fsSymlink(target, lock);
  const inspect = run(cwd, 'inspect', '--id', id, '--json');
  assert.ok(JSON.parse(inspect.stdout)[0].problems.some((p) => p.code === 'lock'));
  assert.notEqual(repair(cwd, id, '--apply').status, 0);
  assert.ok(fsLstat(lock).isSymbolicLink());
  rmSync(lock);
  git(cwd, 'remote', 'set-url', 'origin', 'https://github.com/example/project.git');
  const tools = mkdtempSync(join(tmpdir(), 'repair-gh-')), gh = join(tools, 'gh');
  writeFileSync(gh, '#!/bin/sh\nprintf "[{\\"url\\":\\"https://github.com/example/project/pull/1\\"}]\\n"\n'); chmodSync(gh, 0o755);
  const result = spawnSync(process.execPath, [cli, 'run', 'repair', '--id', id], { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${tools}:${process.env.PATH}` } });
  assert.match(result.stdout, /unavailable|incomplete/);
  assert.doesNotMatch(result.stdout, /no matching GitHub PR/);
});

test('a leftover repair coordination lock is diagnosed and preserved for investigation', () => {
  const cwd = repo(), id = start(cwd);
  const guard = lockPath(cwd, id).replace('/.lock-', '/.repair-');
  const owner = JSON.stringify({ pid: 2147483647, host: hostname(), started: '2000-01-01T00:00:00.000Z' });
  writeFileSync(guard, owner);
  const inspect = run(cwd, 'inspect', '--id', id, '--json');
  assert.ok(JSON.parse(inspect.stdout)[0].problems.some((p) => p.code === 'repair-lock' && p.message.includes('dead')));
  assert.notEqual(repair(cwd, id, '--apply').status, 0);
  assert.equal(readFileSync(guard, 'utf8'), owner);
});


test('repair refuses a proposal when lock ownership changes before application', () => {
  const cwd = repo(), id = start(cwd), path = recordPath(cwd, id), lock = lockPath(cwd, id);
  rmSync(path);
  const store = openRunStore(cwd), plan = store.repairPlan(id);
  const owner = JSON.stringify({ pid: process.pid, host: hostname(), started: new Date().toISOString() });
  writeFileSync(lock, owner);
  assert.throws(() => store.repairApply(id, plan), /facts changed/);
  assert.equal(readFileSync(lock, 'utf8'), owner);
  assert.equal(existsSync(path), false);
});

test('inspect and repair diagnose a missing registered worktree with no Run folder', () => {
  const cwd = repo(), id = start(cwd), path = recordPath(cwd, id);
  const worktree = JSON.parse(readFileSync(path, 'utf8')).worktree;
  const head = git(cwd, 'rev-parse', id);
  rmSync(join(cwd, '.factory', 'runs', id), { recursive: true });
  rmSync(worktree, { recursive: true });
  assert.match(git(cwd, 'worktree', 'list', '--porcelain'), new RegExp(`worktree ${worktree}`));
  const inspect = run(cwd, 'inspect', '--id', id, '--json');
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.ok(JSON.parse(inspect.stdout)[0].problems.some((p) => p.code === 'worktree-missing'));
  const plan = repair(cwd, id);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /missing.*manual|manual.*missing/i);
  assert.doesNotMatch(plan.stdout, /Would recreate/);
  const applied = repair(cwd, id, '--apply');
  assert.notEqual(applied.status, 0);
  assert.equal(existsSync(path), false);
  assert.equal(git(cwd, 'rev-parse', id), head);
});

test('repair never reconstructs records for registered symlinked worktrees', () => {
  for (const dangling of [false, true]) {
    const cwd = repo(), id = start(cwd), path = recordPath(cwd, id);
    const worktree = JSON.parse(readFileSync(path, 'utf8')).worktree;
    rmSync(join(cwd, '.factory', 'runs', id), { recursive: true });
    rmSync(worktree, { recursive: true });
    const target = dangling ? join(cwd, 'not-present') : mkdtempSync(join(tmpdir(), 'not-run-worktree-'));
    fsSymlink(target, worktree);
    const inspect = run(cwd, 'inspect', '--id', id, '--json');
    assert.equal(inspect.status, 0, inspect.stderr);
    assert.ok(JSON.parse(inspect.stdout)[0].problems.some((p) => p.code === 'worktree-unknown'));
    const result = repair(cwd, id, '--apply');
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /unsafe|symlinked/);
    assert.equal(existsSync(path), false);
    assert.ok(fsLstat(worktree).isSymbolicLink());
  }
});
