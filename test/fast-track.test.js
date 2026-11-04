import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli as runCli } from './cli-runner.js';
import { repo, git } from './git-repo.js';

/** @import { Run } from '../src/run-record.js' */

/**
 * @param {string} cwd
 * @param {...string} args
 */
const run = (cwd, ...args) => runCli(cwd, 'run', ...args);
/**
 * @param {string} cwd
 * @param {...string} args
 */
const ok = async (cwd, ...args) => {
  const r = await run(cwd, ...args);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
/**
 * @param {string} cwd
 * @param {string} id
 */
const file = (cwd, id) => join(cwd, '.factory', 'runs', id, 'run.json');
/**
 * @param {string} cwd
 * @param {string} id
 * @returns {Run}
 */
const read = (cwd, id) => JSON.parse(readFileSync(file(cwd, id), 'utf8'));
/** @param {string} cwd */
const start = async (cwd) =>
  await ok(
    cwd,
    'start',
    '--data',
    JSON.stringify({ title: 'Fast', agent: 'codex', commands: 'true', conventions: [] }),
  );
/**
 * @param {string} cwd
 * @param {string} id
 * @param {Record<string, unknown>} data
 */
const update = async (cwd, id, data) => await ok(cwd, 'update', '--id', id, '--data', JSON.stringify(data));
/**
 * @param {string} cwd
 * @param {string} id
 * @param {string} axis
 * @param {string} value
 */
const verdict = async (cwd, id, axis, value) => await run(cwd, 'verdict', '--id', id, '--axis', axis, '--value', value);
/**
 * @param {string} cwd
 * @param {string} id
 */
const commit = (cwd, id) => {
  const w = read(cwd, id).worktree;
  git(w, 'commit', '-q', '--allow-empty', '-m', 'work');
};

/**
 * @param {string} cwd
 * @param {string} id
 * @param {string[]} tickets
 */
async function toCheck(cwd, id, tickets) {
  await update(cwd, id, { spec_link: 'spec.md', tickets, tickets_total: tickets.length, tickets_done: tickets.length });
  await ok(cwd, 'transition', '--id', id, '--to', 'build');
  commit(cwd, id);
  await ok(cwd, 'transition', '--id', id, '--to', 'check');
  await ok(cwd, 'verify', '--id', id);
}

test('the track is chosen in Define only, by the named command, and a record without one is Full', async () => {
  const cwd = repo(),
    id = await start(cwd);
  assert.equal(read(cwd, id).track, undefined);
  assert.notEqual((await run(cwd, 'update', '--id', id, '--data', JSON.stringify({ track: 'fast' }))).status, 0);
  assert.notEqual(
    (
      await run(
        cwd,
        'start',
        '--data',
        JSON.stringify({ title: 'X', agent: 'codex', commands: 'true', conventions: [], track: 'fast' }),
      )
    ).status,
    0,
  );
  assert.notEqual((await run(cwd, 'track', '--id', id, '--value', 'turbo')).status, 0);
  await ok(cwd, 'track', '--id', id, '--value', 'fast');
  assert.equal(read(cwd, id).track, 'fast');
  await toCheck(cwd, id, ['1']);
  const before = read(cwd, id);
  assert.notEqual((await run(cwd, 'track', '--id', id, '--value', 'full')).status, 0);
  assert.deepEqual(read(cwd, id), before);
});

test('a Fast track Run needs exactly one Ticket to build', async () => {
  const cwd = repo(),
    id = await start(cwd);
  await ok(cwd, 'track', '--id', id, '--value', 'fast');
  await update(cwd, id, { spec_link: 'spec.md', tickets: [], tickets_total: 0 });
  assert.match((await run(cwd, 'transition', '--id', id, '--to', 'build')).stderr, /Tickets/);
  await update(cwd, id, { spec_link: 'spec.md', tickets: ['1', '2'], tickets_total: 2 });
  const r = await run(cwd, 'transition', '--id', id, '--to', 'build');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /exactly one Ticket/);
  await update(cwd, id, { tickets: ['1'], tickets_total: 1 });
  await ok(cwd, 'transition', '--id', id, '--to', 'build');
});

test('Finish needs a clean or Accepted Check on both tracks; Standards and Security are always required', async () => {
  for (const track of ['fast', 'full']) {
    const cwd = repo(),
      id = await start(cwd);
    await ok(cwd, 'track', '--id', id, '--value', track);
    await toCheck(cwd, id, ['1']);
    await ok(cwd, 'verdict', '--id', id, '--axis', 'spec', '--value', 'pass');
    await ok(cwd, 'verdict', '--id', id, '--axis', 'infrastructure', '--value', 'skipped');
    assert.equal((await verdict(cwd, id, 'security', 'pass')).status, 0);
    assert.match(
      (await run(cwd, 'transition', '--id', id, '--to', 'finish')).stderr,
      /standards has no verdict/,
      track,
    );
    assert.notEqual((await verdict(cwd, id, 'standards', 'skipped')).status, 0);
    await ok(cwd, 'verdict', '--id', id, '--axis', 'standards', '--value', 'fail');
    assert.match((await run(cwd, 'transition', '--id', id, '--to', 'finish')).stderr, /standards failed/, track);
    await ok(cwd, 'accept', '--id', id, '--data', JSON.stringify({ findings: 'standards failed', decision: 'go on' }));
    await ok(cwd, 'transition', '--id', id, '--to', 'finish');
  }
});

test('the Spec verdict may be skipped on the Fast track only', async () => {
  const full = repo(),
    fullId = await start(full);
  await toCheck(full, fullId, ['1']);
  assert.notEqual((await verdict(full, fullId, 'spec', 'skipped')).status, 0);
  const cwd = repo(),
    id = await start(cwd);
  await ok(cwd, 'track', '--id', id, '--value', 'fast');
  await toCheck(cwd, id, ['1']);
  for (const axis of ['standards', 'security']) await ok(cwd, 'verdict', '--id', id, '--axis', axis, '--value', 'pass');
  await ok(cwd, 'verdict', '--id', id, '--axis', 'spec', '--value', 'skipped');
  await ok(cwd, 'verdict', '--id', id, '--axis', 'infrastructure', '--value', 'skipped');
  await ok(cwd, 'transition', '--id', id, '--to', 'finish');
});

test('a skipped Spec verdict on a Run that is not Fast does not satisfy Finish', async () => {
  const cwd = repo(),
    id = await start(cwd);
  await toCheck(cwd, id, ['1']);
  for (const axis of ['standards', 'security', 'spec', 'infrastructure'])
    await ok(cwd, 'verdict', '--id', id, '--axis', axis, '--value', 'pass');
  const forged = { ...read(cwd, id), spec: 'skipped' };
  writeFileSync(file(cwd, id), JSON.stringify(forged));
  assert.match(
    (await run(cwd, 'transition', '--id', id, '--to', 'finish')).stderr,
    /spec cannot be skipped on this track/,
  );
});

test('stats show the track per Run and totals per track, counting a Run without a track as Full', async () => {
  const cwd = repo(),
    fast = await start(cwd),
    full = await start(cwd);
  await ok(cwd, 'track', '--id', fast, '--value', 'fast');
  assert.match(await ok(cwd, 'stats', '--id', fast), /Track: Fast/);
  assert.match(await ok(cwd, 'stats', '--id', full), /Track: Full/);
  const all = await ok(cwd, 'stats', '--all');
  assert.match(all, /Total observed, Fast track \(1 Run\(s\)\)/);
  assert.match(all, /Total observed, Full track \(1 Run\(s\)\)/);
});
