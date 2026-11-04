import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli } from './cli-runner.js';
import { repo } from './git-repo.js';

/**
 * @param {string} cwd
 * @param {...string} args
 */
async function run(cwd, ...args) {
  return await cli(cwd, 'run', ...args);
}
test('Run rejects non-string Agent targets', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'factory-run-'));
  const result = await run(
    cwd,
    'start',
    '--data',
    JSON.stringify({ title: 'Example', agent: ['codex'], commands: 'npm test', conventions: [] }),
  );
  assert.notEqual(result.status, 0);
});
test('Run record command creates and safely updates a record', async () => {
  const cwd = repo();
  const start = await run(
    cwd,
    'start',
    '--data',
    JSON.stringify({ title: 'Example', agent: 'codex', commands: 'npm test', conventions: ['AGENTS.md'] }),
  );
  assert.equal(start.status, 0, start.stderr);
  const id = start.stdout.trim();
  const file = join(cwd, '.factory', 'runs', id, 'run.json');
  const created = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(created.stage, 'define');
  const update = await run(
    cwd,
    'update',
    '--id',
    id,
    '--data',
    JSON.stringify({ status: 'waiting', waiting_reason: 'answer', activity: 'asking' }),
  );
  assert.equal(update.status, 0, update.stderr);
  const waiting = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(waiting.waiting_on_human, true);
  assert.equal(waiting.created, created.created);
  const bad = await run(cwd, 'update', '--id', id, '--data', JSON.stringify({ stage: 'wrong' }));
  assert.notEqual(bad.status, 0);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), waiting);
});
test('a Run command without its --id, --to, --axis or --value flag is refused with the store messages', async () => {
  const cwd = repo();
  const start = await run(
    cwd,
    'start',
    '--data',
    JSON.stringify({ title: 'Example', agent: 'codex', commands: 'npm test', conventions: ['AGENTS.md'] }),
  );
  const id = start.stdout.trim();
  /** @param {...string} args */
  const error = async (...args) =>
    (await run(cwd, ...args)).stderr.split('\n').find((line) => line.startsWith('error'));
  assert.equal(await error('transition'), 'error: invalid Run id');
  assert.equal(await error('transition', '--id', id), 'error: a Run in define can only move to build, not undefined');
  assert.equal(await error('verdict'), 'error: unknown Check axis: undefined');
  assert.equal(await error('verdict', '--id', id, '--value', 'pass'), 'error: unknown Check axis: undefined');
  assert.equal(await error('verdict', '--id', id, '--axis', 'standards'), 'error: invalid field or value: standards');
  assert.equal(await error('track', '--id', id), 'error: track must be fast or full');
  assert.equal(await error('materialize-review', '--id', id), 'error: unknown project review: undefined');
});
