import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo } from './git-repo.js';

const cli = resolve('bin/tds-factory.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });
const start = (cwd, extra = {}) => {
  const result = run(cwd, 'start', '--data', JSON.stringify({ title: 'Fast', agent: 'claude', commands: 'node -e "process.exit(0)"', conventions: [], ...extra }));
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const record = (cwd, id) => JSON.parse(readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8'));

test('a Run records the fast Verify command given at start, and rejects an unusable one', () => {
  const cwd = repo();
  const id = start(cwd, { fast_commands: 'node -e "process.exit(0)"' });
  assert.equal(record(cwd, id).fast_commands, 'node -e "process.exit(0)"');
  const bad = run(cwd, 'start', '--data', JSON.stringify({ title: 'Bad', agent: 'claude', commands: 'npm test', fast_commands: 'a\0b', conventions: [] }));
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /fast Verify command/);
});

test('verify --fast runs the fast command, keeps its own log and records no Verify result', () => {
  const cwd = repo();
  const id = start(cwd, { fast_commands: 'node -e "console.log(\'quick\')"' });
  const result = run(cwd, 'verify', '--id', id, '--fast');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fast verify passed/);
  assert.match(result.stdout, /not Evidence/);
  assert.match(readFileSync(join(cwd, '.factory', 'runs', id, 'verify-fast.log'), 'utf8'), /quick/);
  assert.equal(record(cwd, id).verify, undefined, 'a fast Verify is never Evidence');
  assert.equal(existsSync(join(cwd, '.factory', 'runs', id, 'verify.log')), false);
});

test('a failing fast Verify exits non-zero and still records nothing', () => {
  const cwd = repo();
  const id = start(cwd, { fast_commands: 'node -e "process.exit(4)"' });
  const result = run(cwd, 'verify', '--id', id, '--fast');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /fast verify failed \(exit 4\)/);
  assert.equal(record(cwd, id).verify, undefined);
});

test('verify --fast without a fast command refuses and names the full Verify', () => {
  const cwd = repo();
  const id = start(cwd);
  const result = run(cwd, 'verify', '--id', id, '--fast');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no fast Verify command/);
  assert.match(result.stderr, /run verify --id/);
});

test('the full Verify is unchanged and still records the Evidence', () => {
  const cwd = repo();
  const id = start(cwd, { fast_commands: 'node -e "process.exit(1)"' });
  const result = run(cwd, 'verify', '--id', id);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(record(cwd, id).verify.exit_code, 0);
});
