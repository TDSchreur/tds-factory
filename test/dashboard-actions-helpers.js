import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { git, repo } from './git-repo.js';
import { writeHeaders } from './dashboard-token.js';
import { viewsOf } from './run-view.js';
import { waitUntil } from './wait-until.js';

/** @import { Run } from '../src/run-record.js' */

export const cli = resolve('bin/tds-factory.js');

/**
 * @param {string} cwd
 * @param {string[]} args
 */
export const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'run', ...args], { cwd, encoding: 'utf8' });

/** @param {import('node:child_process').SpawnSyncReturns<string>} result */
export const ok = (result) => {
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

/**
 * @param {string} cwd
 * @param {string} id
 * @returns {Run}
 */
export const read = (cwd, id) => JSON.parse(readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8'));

/** @param {unknown} value */
export const data = (value) => JSON.stringify(value);

export const PR = 'https://github.com/o/r/pull/1';

// A Run in Check on top of `origin` (the same repository).
/** @param {string} [existing] @param {string} [title] */
export function checked(existing, title = 'Actions') {
  const cwd = existing ?? repo();
  if (!existing) {
    git(cwd, 'config', 'user.name', 't'); // the rebase in sync commits, and CI has no global identity
    git(cwd, 'config', 'user.email', 't@t');
    writeFileSync(join(cwd, '.gitignore'), '.factory/\n');
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-q', '-m', 'ignore');
  }
  const id = ok(run(cwd, 'start', '--data', data({ title, agent: 'claude', commands: 'true', conventions: [] })));
  const wt = read(cwd, id).worktree;
  ok(
    run(cwd, 'update', '--id', id, '--data', data({ spec_link: 'docs/specs/x.md', tickets: ['1'], tickets_total: 1 })),
  );
  ok(run(cwd, 'transition', '--id', id, '--to', 'build'));
  writeFileSync(join(wt, 'mine.txt'), 'mine\n');
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 'mine');
  ok(run(cwd, 'update', '--id', id, '--data', data({ tickets_done: 1 })));
  ok(run(cwd, 'transition', '--id', id, '--to', 'check'));
  return { cwd, id, wt };
}

/**
 * @param {string} cwd
 * @param {string} id
 * @param {string} [security]
 */
export const review = (cwd, id, security = 'pass') => {
  ok(run(cwd, 'verify', '--id', id));
  for (const [axis, value] of [
    ['standards', 'pass'],
    ['spec', 'pass'],
    ['security', security],
    ['infrastructure', 'skipped'],
  ])
    ok(run(cwd, 'verdict', '--id', id, '--axis', axis, '--value', value));
};

/**
 * @param {string} cwd
 * @param {string} id
 */
export const waiting = (cwd, id) =>
  ok(run(cwd, 'update', '--id', id, '--data', data({ status: 'waiting', waiting_reason: 'accept the Check' })));

/**
 * @param {{ url: string, projectId: string }} dash
 * @param {string} id
 * @param {string} action
 * @param {string} [updated]
 */
export async function post(dash, id, action, updated) {
  let stamp = updated ?? '';
  if (action === 'accept' && updated === undefined)
    stamp = (await viewsOf(dash)).find((r) => r.id === id)?.updated ?? '';
  const query = action === 'accept' ? `?updated=${encodeURIComponent(stamp)}` : '';
  const response = await fetch(`${dash.url}/api/projects/${dash.projectId}/runs/${id}/${action}${query}`, {
    method: 'POST',
    headers: await writeHeaders(dash),
  });
  return { status: response.status, text: await response.text() };
}

// ADR 0024: the extra loop. A Run in Check that waits on the user at its loop limit.
export function atLimit() {
  const { cwd, id, wt } = checked();
  const file = join(cwd, '.factory', 'runs', id, 'run.json');
  writeFileSync(
    file,
    JSON.stringify({
      ...read(cwd, id),
      check_loops: 4,
      status: 'waiting',
      waiting_on_human: true,
      waiting_reason: 'Blocking findings remain',
    }),
  );
  return { cwd, id, wt };
}

/**
 * @param {{ url: string }} dash
 * @param {string} id
 */
export const updatedOf = async (dash, id) => (await viewsOf(dash)).find((r) => r.id === id)?.updated ?? '';

/**
 * @param {{ url: string, projectId: string }} dash
 * @param {string} id
 * @param {string} [query]
 * @param {Record<string, string>} [headers]
 */
export const grant = async (dash, id, query, headers) => {
  const response = await fetch(
    `${dash.url}/api/projects/${dash.projectId}/runs/${id}/extra-loop${query ?? `?updated=${encodeURIComponent(await updatedOf(dash, id))}`}`,
    { method: 'POST', headers: headers ?? (await writeHeaders(dash)) },
  );
  return { status: response.status, text: await response.text() };
};

// A finished Run with a PR, so that clean asks the PR lookup.
/** @param {string} [cwd] @param {string} [title] */
export function finished(cwd, title) {
  const made = checked(cwd, title);
  review(made.cwd, made.id);
  ok(run(made.cwd, 'transition', '--id', made.id, '--to', 'finish'));
  ok(run(made.cwd, 'update', '--id', made.id, '--data', data({ pr: PR })));
  ok(run(made.cwd, 'complete', '--id', made.id));
  return { ...made, tip: git(made.wt, 'rev-parse', 'HEAD') };
}

// A promise that is settled from outside, and a way to wait until `count` calls have started.
export function gate() {
  /** @type {() => void} */
  let open = () => {};
  const opened = new Promise((done) => (open = () => done(undefined)));
  let entered = 0;
  return {
    opened,
    open,
    enter: () => entered++,
    /** @param {number} count */
    async reached(count) {
      await waitUntil(() => entered >= count, { message: 'the held calls started' });
    },
  };
}
