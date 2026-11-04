import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli as runCli } from './cli-runner.js';
import { repo } from './git-repo.js';

/** @import { Run } from '../src/run-record.js' */

/**
 * @param {string} cwd
 * @param {...string} args
 */
const run = (cwd, ...args) => runCli(cwd, 'run', ...args);
/** @param {string} cwd */
const start = async (cwd, extra = {}) => {
  const result = await run(
    cwd,
    'start',
    '--data',
    JSON.stringify({
      title: 'Fast',
      agent: 'claude',
      commands: 'node -e "process.exit(0)"',
      conventions: [],
      ...extra,
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
/**
 * @param {string} cwd
 * @param {string} id
 * @returns {Run}
 */
const record = (cwd, id) => JSON.parse(readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8'));

test('a Run records the fast Verify command given at start, and rejects an unusable one', async () => {
  const cwd = repo();
  const id = await start(cwd, { fast_commands: 'node -e "process.exit(0)"' });
  assert.equal(record(cwd, id).fast_commands, 'node -e "process.exit(0)"');
  const bad = await run(
    cwd,
    'start',
    '--data',
    JSON.stringify({ title: 'Bad', agent: 'claude', commands: 'npm test', fast_commands: 'a\0b', conventions: [] }),
  );
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /fast Verify command/);
});

test('verify --fast runs the fast command, keeps its own log and records no Verify result', async () => {
  const cwd = repo();
  const id = await start(cwd, { fast_commands: 'node -e "console.log(\'quick\')"' });
  const result = await run(cwd, 'verify', '--id', id, '--fast');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fast verify passed/);
  assert.match(result.stdout, /not Evidence/);
  assert.match(readFileSync(join(cwd, '.factory', 'runs', id, 'verify-fast.log'), 'utf8'), /quick/);
  assert.equal(record(cwd, id).verify, undefined, 'a fast Verify is never Evidence');
  assert.equal(existsSync(join(cwd, '.factory', 'runs', id, 'verify.log')), false);
});

test('a failing fast Verify exits non-zero and still records nothing', async () => {
  const cwd = repo();
  const id = await start(cwd, { fast_commands: 'node -e "process.exit(4)"' });
  const result = await run(cwd, 'verify', '--id', id, '--fast');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /fast verify failed \(exit 4\)/);
  assert.equal(record(cwd, id).verify, undefined);
});

test('verify --fast without a fast command refuses and names the full Verify', async () => {
  const cwd = repo();
  const id = await start(cwd);
  const result = await run(cwd, 'verify', '--id', id, '--fast');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no fast Verify command/);
  assert.match(result.stderr, /run verify --id/);
});

test('the full Verify is unchanged and still records the Evidence', async () => {
  const cwd = repo();
  const id = await start(cwd, { fast_commands: 'node -e "process.exit(1)"' });
  const result = await run(cwd, 'verify', '--id', id);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(record(cwd, id).verify?.exit_code, 0);
});

test('run update cannot set the fast command after the Run has started', async () => {
  const cwd = repo();
  const id = await start(cwd);
  const result = await run(cwd, 'update', '--id', id, '--data', JSON.stringify({ fast_commands: 'npm run test:unit' }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fast Verify command is set when the Run starts/);
  assert.equal(record(cwd, id).fast_commands, undefined);
});
