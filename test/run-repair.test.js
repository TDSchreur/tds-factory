import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync as fsLstat,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync as fsSymlink,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli, cliWith } from './cli-runner.js';
import { git, repo } from './git-repo.js';
import { envWith, fakeCommand } from './fake-command.js';
import { openRunStore } from '../src/run-store.js';

/** @param {string} stdout The JSON that inspect prints. */
const problemsOf = (stdout) => {
  /** @type {{ problems: { code: string, message: string }[] }[]} */
  const reports = JSON.parse(stdout);
  return reports[0].problems;
};
/**
 * @param {string} cwd
 * @param {...string} args
 */
const run = async (cwd, ...args) => await cli(cwd, 'run', ...args);
/** @param {string} cwd */
const start = async (cwd) => {
  const result = await run(
    cwd,
    'start',
    '--data',
    JSON.stringify({ title: 'Recover', agent: 'codex', commands: 'true', conventions: [] }),
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
/**
 * @param {string} cwd
 * @param {string} id
 */
const recordPath = (cwd, id) => join(cwd, '.factory', 'runs', id, 'run.json');
/**
 * @param {string} cwd
 * @param {string} id
 */
const lockPath = (cwd, id) => join(cwd, '.factory', 'runs', `.lock-${createHash('sha256').update(id).digest('hex')}`);
/**
 * @param {string} cwd
 * @param {string} id
 * @param {...string} args
 */
const repair = async (cwd, id, ...args) => await run(cwd, 'repair', '--id', id, ...args);

test('repair proposes and then reconstructs a dirty orphan without repeating work', async () => {
  const cwd = repo(),
    id = await start(cwd),
    path = recordPath(cwd, id);
  const worktree = JSON.parse(readFileSync(path, 'utf8')).worktree;
  writeFileSync(join(worktree, 'unfinished'), 'keep this');
  rmSync(join(cwd, '.factory', 'runs', id), { recursive: true });
  const inspect = await run(cwd, 'inspect', '--id', id, '--json');
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.ok(problemsOf(inspect.stdout).some((p) => p.code === 'orphan'));
  const before = git(cwd, 'rev-parse', id);
  const plan = await repair(cwd, id);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /recreate|reconstruct/i);
  assert.equal(existsSync(path), false);
  assert.equal((await repair(cwd, id, '--apply')).status, 0);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(record.status, 'interrupted');
  assert.equal(record.worktree, worktree);
  assert.equal(record.stage, 'define');
  assert.equal(record.commands, '');
  assert.equal(record.verify, undefined);
  assert.equal(git(cwd, 'rev-parse', id), before);
  assert.equal(readFileSync(join(worktree, 'unfinished'), 'utf8'), 'keep this');
});

test('repair never removes a lock by age and only applies a dead local owner', async () => {
  const cwd = repo(),
    id = await start(cwd),
    lock = lockPath(cwd, id);
  const old = { pid: process.pid, host: hostname(), started: '2000-01-01T00:00:00.000Z' };
  for (const value of [JSON.stringify(old), JSON.stringify({ ...old, host: 'another-host' }), '', '{broken']) {
    writeFileSync(lock, value);
    assert.notEqual((await repair(cwd, id, '--apply')).status, 0);
    assert.equal(readFileSync(lock, 'utf8'), value);
  }
  const dead = JSON.stringify({ ...old, pid: 2147483647 });
  writeFileSync(lock, dead);
  const plan = await repair(cwd, id);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /dead/);
  assert.equal(readFileSync(lock, 'utf8'), dead);
  const applied = await repair(cwd, id, '--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(existsSync(lock), false);
  assert.equal((await repair(cwd, id, '--apply')).status, 0);
});

test('repair preserves corrupt records and refuses mismatched worktree branches', async () => {
  const cwd = repo(),
    id = await start(cwd),
    path = recordPath(cwd, id);
  writeFileSync(path, '{broken');
  assert.notEqual((await repair(cwd, id, '--apply')).status, 0);
  assert.equal(readFileSync(path, 'utf8'), '{broken');
  rmSync(path);
  const wt = join(cwd, '.factory', 'worktrees', id);
  git(wt, 'switch', '-q', '-c', 'some-other-branch');
  assert.notEqual((await repair(cwd, id, '--apply')).status, 0);
  assert.equal(existsSync(path), false);
});

test('repair reconciles the exact GitHub repository and existing PR before adopting it', async () => {
  const cwd = repo(),
    id = await start(cwd),
    file = recordPath(cwd, id);
  git(cwd, 'remote', 'set-url', 'origin', 'https://github.com/example/project.git');
  const tools = mkdtempSync(join(tmpdir(), 'repair-gh-'));
  const calls = join(tools, 'calls');
  const pr = {
    url: 'https://github.com/example/project/pull/123',
    headRefName: id,
    headRepositoryOwner: { login: 'example' },
    headRepository: { name: 'project' },
  };
  fakeCommand(
    tools,
    'gh',
    `require('fs').appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(' ') + '\\n');\nconsole.log(${JSON.stringify(JSON.stringify([pr]))});\n`,
  );
  /** @param {...string} args */
  const invoke = async (...args) => await cliWith({ env: envWith(tools) }, cwd, 'run', 'repair', '--id', id, ...args);
  const plan = await invoke();
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /adopt existing PR/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pr, undefined);
  const applied = await invoke('--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pr, pr.url);
  assert.match(readFileSync(calls, 'utf8'), new RegExp(`pr list --repo example/project --head ${id} --state all`));
  assert.equal((await invoke('--apply')).status, 0);
});

test('ambiguous, unavailable, and conflicting GitHub results do not rewrite a PR link', async () => {
  const cwd = repo(),
    id = await start(cwd),
    file = recordPath(cwd, id);
  git(cwd, 'remote', 'set-url', 'origin', 'https://github.com/example/project.git');
  const tools = mkdtempSync(join(tmpdir(), 'repair-gh-'));
  /** @param {number} n */
  const pr = (n) => ({
    url: `https://github.com/example/project/pull/${n}`,
    headRefName: id,
    headRepositoryOwner: { login: 'example' },
    headRepository: { name: 'project' },
  });
  /** @param {unknown} data */
  const fixture = (data) => {
    fakeCommand(tools, 'gh', `console.log(${JSON.stringify(JSON.stringify(data))});\n`);
  };
  /** @param {...string} args */
  const invoke = async (...args) => await cliWith({ env: envWith(tools) }, cwd, 'run', 'repair', '--id', id, ...args);
  fixture([pr(1), pr(2)]);
  assert.match((await invoke('--apply')).stdout, /ambiguous/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pr, undefined);
  fakeCommand(tools, 'gh', 'process.exit(1);\n');
  assert.match((await invoke('--apply')).stdout, /unavailable/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pr, undefined);
  const record = JSON.parse(readFileSync(file, 'utf8'));
  record.pr = 'https://github.com/example/project/pull/99';
  writeFileSync(file, JSON.stringify(record));
  fixture([pr(1)]);
  assert.match((await invoke('--apply')).stdout, /conflicts/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pr, record.pr);
});

test('dangling lock symlinks and incomplete GitHub responses remain unresolved', async () => {
  const cwd = repo(),
    id = await start(cwd),
    lock = lockPath(cwd, id);
  const target = join(cwd, 'missing-lock-target');
  fsSymlink(target, lock);
  const inspect = await run(cwd, 'inspect', '--id', id, '--json');
  assert.ok(problemsOf(inspect.stdout).some((p) => p.code === 'lock'));
  assert.notEqual((await repair(cwd, id, '--apply')).status, 0);
  assert.ok(fsLstat(lock).isSymbolicLink());
  rmSync(lock);
  git(cwd, 'remote', 'set-url', 'origin', 'https://github.com/example/project.git');
  const tools = mkdtempSync(join(tmpdir(), 'repair-gh-'));
  fakeCommand(tools, 'gh', 'console.log(\'[{"url":"https://github.com/example/project/pull/1"}]\');\n');
  const result = await cliWith({ env: envWith(tools) }, cwd, 'run', 'repair', '--id', id);
  assert.match(result.stdout, /unavailable|incomplete/);
  assert.doesNotMatch(result.stdout, /no matching GitHub PR/);
});

test('a leftover repair coordination lock is diagnosed and preserved for investigation', async () => {
  const cwd = repo(),
    id = await start(cwd);
  const guard = lockPath(cwd, id).replace('.lock-', '.repair-');
  const owner = JSON.stringify({ pid: 2147483647, host: hostname(), started: '2000-01-01T00:00:00.000Z' });
  writeFileSync(guard, owner);
  const inspect = await run(cwd, 'inspect', '--id', id, '--json');
  assert.ok(problemsOf(inspect.stdout).some((p) => p.code === 'repair-lock' && p.message.includes('dead')));
  assert.notEqual((await repair(cwd, id, '--apply')).status, 0);
  assert.equal(readFileSync(guard, 'utf8'), owner);
});

test('repair refuses a proposal when lock ownership changes before application', async () => {
  const cwd = repo(),
    id = await start(cwd),
    path = recordPath(cwd, id),
    lock = lockPath(cwd, id);
  rmSync(path);
  const store = openRunStore(cwd),
    plan = store.repairPlan(id);
  const owner = JSON.stringify({ pid: process.pid, host: hostname(), started: new Date().toISOString() });
  writeFileSync(lock, owner);
  assert.throws(() => store.repairApply(id, plan), /facts changed/);
  assert.equal(readFileSync(lock, 'utf8'), owner);
  assert.equal(existsSync(path), false);
});

test('inspect and repair diagnose a missing registered worktree with no Run folder', async () => {
  const cwd = repo(),
    id = await start(cwd),
    path = recordPath(cwd, id);
  const worktree = JSON.parse(readFileSync(path, 'utf8')).worktree;
  const head = git(cwd, 'rev-parse', id);
  rmSync(join(cwd, '.factory', 'runs', id), { recursive: true });
  rmSync(worktree, { recursive: true });
  assert.ok(git(cwd, 'worktree', 'list', '--porcelain').includes(`worktree ${worktree.replaceAll('\\', '/')}`));
  const inspect = await run(cwd, 'inspect', '--id', id, '--json');
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.ok(problemsOf(inspect.stdout).some((p) => p.code === 'worktree-missing'));
  const plan = await repair(cwd, id);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /missing.*manual|manual.*missing/i);
  assert.doesNotMatch(plan.stdout, /Would recreate/);
  const applied = await repair(cwd, id, '--apply');
  assert.notEqual(applied.status, 0);
  assert.equal(existsSync(path), false);
  assert.equal(git(cwd, 'rev-parse', id), head);
});

test('repair never reconstructs records for registered symlinked worktrees', async () => {
  for (const dangling of [false, true]) {
    const cwd = repo(),
      id = await start(cwd),
      path = recordPath(cwd, id);
    const worktree = JSON.parse(readFileSync(path, 'utf8')).worktree;
    rmSync(join(cwd, '.factory', 'runs', id), { recursive: true });
    rmSync(worktree, { recursive: true });
    const target = dangling ? join(cwd, 'not-present') : mkdtempSync(join(tmpdir(), 'not-run-worktree-'));
    fsSymlink(target, worktree);
    const inspect = await run(cwd, 'inspect', '--id', id, '--json');
    assert.equal(inspect.status, 0, inspect.stderr);
    assert.ok(problemsOf(inspect.stdout).some((p) => p.code === 'worktree-unknown'));
    const result = await repair(cwd, id, '--apply');
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /unsafe|symlinked/);
    assert.equal(existsSync(path), false);
    assert.ok(fsLstat(worktree).isSymbolicLink());
  }
});

test('repair leaves an Azure DevOps origin to the user: it names no PR lookup and calls neither gh nor az', async () => {
  const cwd = repo(),
    id = await start(cwd);
  git(cwd, 'remote', 'set-url', 'origin', 'https://dev.azure.com/example/project/_git/project');
  const tools = mkdtempSync(join(tmpdir(), 'repair-az-'));
  const calls = join(tools, 'calls');
  for (const tool of ['gh', 'az']) {
    fakeCommand(
      tools,
      tool,
      `require('fs').appendFileSync(${JSON.stringify(calls)}, ${JSON.stringify(tool)} + ' ' + process.argv.slice(2).join(' ') + '\\n');\nprocess.exit(1);\n`,
    );
  }
  const plan = await cliWith({ env: envWith(tools) }, cwd, 'run', 'repair', '--id', id);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /not GitHub; reconcile any PR manually/);
  assert.equal(existsSync(calls), false);
});
