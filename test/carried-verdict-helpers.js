import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { git, repo } from './git-repo.js';
import { cli as runCli } from './cli-runner.js';

/** @import { Run } from '../src/run-record.js' */

export const cli = resolve('bin/tds-factory.js');

/**
 * @param {string} cwd
 * @param {...string} args
 */
export const run = (cwd, ...args) => runCli(cwd, 'run', ...args);

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

/**
 * @param {string} cwd
 * @param {string} id
 * @param {Record<string, unknown>} data
 */
export const force = (cwd, id, data) => writeFileSync(file(cwd, id), JSON.stringify({ ...read(cwd, id), ...data }));

/**
 * @param {string} cwd
 * @param {string} id
 * @param {string} axis
 * @param {string} value
 * @param {...string} more
 */
export const verdict = async (cwd, id, axis, value, ...more) =>
  await run(cwd, 'verdict', '--id', id, '--axis', axis, '--value', value, ...more);

// A Run in Check whose first pass gave Security pass and Infrastructure skipped; a Rework then sent it back and returned it to Check.
export async function afterRework(initial = {}) {
  const cwd = repo();
  const started = await run(
    cwd,
    'start',
    '--data',
    JSON.stringify({ title: 'Carry', agent: 'codex', commands: 'true', conventions: [] }),
  );
  assert.equal(started.status, 0, started.stderr);
  const id = started.stdout.trim();
  const worktree = read(cwd, id).worktree;
  for (const [name, text] of Object.entries(initial)) {
    mkdirSync(dirname(join(worktree, name)), { recursive: true });
    writeFileSync(join(worktree, name), text);
  }
  if (Object.keys(initial).length) {
    git(worktree, 'add', '.');
    git(worktree, 'commit', '-q', '-m', 'initial');
  }
  force(cwd, id, { stage: 'check' });
  assert.equal((await verdict(cwd, id, 'security', 'pass')).status, 0);
  assert.equal((await verdict(cwd, id, 'infrastructure', 'skipped')).status, 0);
  const first = git(worktree, 'rev-parse', 'HEAD');
  assert.equal((await run(cwd, 'rework', '--id', id)).status, 0);
  force(cwd, id, { stage: 'check' });
  const base = git(worktree, 'rev-parse', 'HEAD');
  // Lets a test try many changes on one Run; each start costs several processes, which is slow on Windows.
  const reset = () => git(worktree, 'reset', '-q', '--hard', base);
  /** @param {string} name */
  const change = (name, text = 'text\n') => {
    mkdirSync(dirname(join(worktree, name)), { recursive: true });
    writeFileSync(join(worktree, name), text);
    git(worktree, 'add', '.');
    git(worktree, 'commit', '-q', '-m', `edit ${name}`);
  };
  return { cwd, id, worktree, first, change, reset };
}

// Windows has no executable bit and symlinks need privileges, so those cases are skipped there.
export const POSIX_ONLY =
  process.platform === 'win32' ? 'symlinks and the executable bit need a POSIX file system' : false;
