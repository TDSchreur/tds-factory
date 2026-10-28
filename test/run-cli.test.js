import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo } from './git-repo.js';

const cli = resolve('bin/tds-factory.js');
function run(cwd, ...args) { return spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' }); }
test('Run rejects non-string Agent targets', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'factory-run-'));
  const result = run(cwd, 'start', '--data', JSON.stringify({ title: 'Example', agent: ['codex'], commands: 'npm test', conventions: [] }));
  assert.notEqual(result.status, 0);
});
test('Run record command creates and safely updates a record', () => {
  const cwd = repo();
  const start = run(cwd, 'start', '--data', JSON.stringify({ title: 'Example', agent: 'codex', commands: 'npm test', conventions: ['AGENTS.md'] }));
  assert.equal(start.status, 0, start.stderr);
  const id = start.stdout.trim();
  const file = join(cwd, '.factory', 'runs', id, 'run.json');
  const created = JSON.parse(readFileSync(file));
  assert.equal(created.stage, 'define');
  const update = run(cwd, 'update', '--id', id, '--data', JSON.stringify({ status: 'waiting', waiting_reason: 'answer', activity: 'asking' }));
  assert.equal(update.status, 0, update.stderr);
  const waiting = JSON.parse(readFileSync(file));
  assert.equal(waiting.waiting_on_human, true);
  assert.equal(waiting.created, created.created);
  const bad = run(cwd, 'update', '--id', id, '--data', JSON.stringify({ stage: 'wrong' }));
  assert.notEqual(bad.status, 0);
  assert.deepEqual(JSON.parse(readFileSync(file)), waiting);
});
