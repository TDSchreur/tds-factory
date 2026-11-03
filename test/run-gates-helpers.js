import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { git } from './git-repo.js';
import { defined as present } from './run-view.js';

/** @import { Run } from '../src/run-record.js' */

export const cli = resolve('bin/tds-factory.js');

/**
 * @param {string} cwd
 * @param {...string} args
 */
export const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });

/** @param {unknown} value */
export const json = (value) => JSON.stringify(value);

/**
 * @param {string} cwd
 * @param {string} id
 */
export const file = (cwd, id) => join(cwd, '.factory', 'runs', id, 'run.json');

/**
 * @param {string} cwd
 * @param {string} id
 * @returns {Run}
 */
export const read = (cwd, id) => JSON.parse(readFileSync(file(cwd, id), 'utf8'));

/** @param {string} cwd */
export const startRun = (cwd, commands = 'npm test') => {
  const result = run(cwd, 'start', '--data', json({ title: 'Example', agent: 'codex', commands, conventions: [] }));
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

/**
 * @param {string} cwd
 * @param {string} id
 * @param {Record<string, unknown>} data
 */
export const update = (cwd, id, data) => run(cwd, 'update', '--id', id, '--data', json(data));

// Fixture: put a Run in a state that only later tickets' operations can reach.
/**
 * @param {string} cwd
 * @param {string} id
 * @param {Record<string, unknown>} fields
 */
export const force = (cwd, id, fields) => writeFileSync(file(cwd, id), json({ ...read(cwd, id), ...fields }));

/**
 * @param {string} cwd
 * @param {string} id
 * @param {string} to
 */
export const transition = (cwd, id, to) => run(cwd, 'transition', '--id', id, '--to', to);

/** @param {string} cwd */
export const defined = (cwd) => {
  const id = startRun(cwd);
  update(cwd, id, { spec_link: 'docs/specs/x.md', tickets: ['1', '2'], tickets_total: 2 });
  return id;
};

/**
 * @param {string} cwd
 * @param {string} id
 */
export const head = (cwd, id) => git(read(cwd, id).worktree, 'rev-parse', 'HEAD');

// Prints the working directory in sh and in cmd.exe.
export const ABANDON = JSON.stringify({ status: 'abandoned' });

export const WHERE = process.platform === 'win32' ? 'cd' : 'pwd';

/**
 * @param {string} cwd
 * @param {string} id
 */
export const verify = (cwd, id) => run(cwd, 'verify', '--id', id);

/**
 * @param {string} cwd
 * @param {string} id
 * @param {string} axis
 * @param {string} value
 */
export const verdict = (cwd, id, axis, value) => run(cwd, 'verdict', '--id', id, '--axis', axis, '--value', value);

/**
 * @param {string} cwd
 * @param {string} id
 * @param {Record<string, unknown>} data
 */
export const accept = (cwd, id, data) => run(cwd, 'accept', '--id', id, '--data', json(data));

/**
 * @param {string} cwd
 * @param {string} id
 */
export const commit = (cwd, id) => git(read(cwd, id).worktree, 'commit', '-q', '--allow-empty', '-m', 'more work');

// A Run in Check whose Verify result and verdicts are all current and passing.
/** @param {string} cwd */
export const cleanCheck = (cwd, commands = 'true') => {
  const id = startRun(cwd, commands);
  force(cwd, id, { stage: 'check', tickets: ['1'], tickets_total: 1, tickets_done: 1 });
  verify(cwd, id);
  for (const [axis, value] of [
    ['standards', 'pass'],
    ['spec', 'pass'],
    ['security', 'pass'],
    ['infrastructure', 'skipped'],
  ])
    assert.equal(verdict(cwd, id, axis, value).status, 0);
  return id;
};

/**
 * @param {string} cwd
 * @param {string} id
 * @param {string} why
 */
export const refusesFinish = (cwd, id, why) => {
  const before = read(cwd, id);
  assert.notEqual(transition(cwd, id, 'finish').status, 0, why);
  assert.deepEqual(read(cwd, id), before, why);
};

/**
 * @param {string} cwd
 * @param {...string} args
 */
export const inspect = (cwd, ...args) => run(cwd, 'inspect', '--json', ...args);

/**
 * @param {string} cwd
 * @param {string} id
 */
export const problems = (cwd, id) => {
  const result = inspect(cwd);
  assert.equal(result.status, 0, result.stderr);
  /** @type {{ id: string, problems: { code: string }[] }[]} */
  const reports = JSON.parse(result.stdout);
  return present(
    reports.find((r) => r.id === id),
    `${id} is inspected`,
  ).problems.map((p) => p.code);
};
