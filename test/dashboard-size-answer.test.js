import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repo } from './git-repo.js';
import { writeHeaders } from './dashboard-token.js';
import { startDashboard } from '../src/dashboard.js';
import { openRunStore } from '../src/run-store.js';
import { readEvents } from '../src/run-events.js';
import { viewsOf } from './run-view.js';

/** @import { Run } from '../src/run-record.js' */

const REASON = 'Run size over the limit: split the remaining Tickets into a new Run?';
/** @param {string} cwd @param {string} id */
const file = (cwd, id) => join(cwd, '.factory', 'runs', id, 'run.json');
/** @param {string} cwd @param {string} id @returns {Run} */
const read = (cwd, id) => JSON.parse(readFileSync(file(cwd, id), 'utf8'));

// A Run in Build with `tickets` of which `done` are done, waiting on the user for the size answer.
/** @param {Partial<Run>} [over] @param {string[]} [tickets] */
function waitingForSize(over = {}, tickets = ['t1', 't2', 't3', 't4']) {
  const cwd = repo();
  const id = openRunStore(cwd).start({ title: 'Size', agent: 'claude', commands: 'true', conventions: [] });
  writeFileSync(
    file(cwd, id),
    JSON.stringify({
      ...read(cwd, id),
      stage: 'build',
      status: 'waiting',
      waiting_on_human: true,
      waiting_reason: REASON,
      tickets,
      tickets_done: 1,
      tickets_total: tickets.length,
      ...over,
    }),
  );
  return { cwd, id };
}
/** @param {{ url: string }} dash @param {string} id */
const updatedOf = async (dash, id) => (await viewsOf(dash)).find((r) => r.id === id)?.updated ?? '';
/**
 * @param {{ url: string, projectId: string }} dash
 * @param {string} id
 * @param {string} action
 * @param {string} [query] Defaults to the record time the page showed.
 * @param {Record<string, string>} [headers]
 */
async function answer(dash, id, action, query, headers) {
  const response = await fetch(
    `${dash.url}/api/projects/${dash.projectId}/runs/${id}/${action}${query ?? `?updated=${encodeURIComponent(await updatedOf(dash, id))}`}`,
    { method: 'POST', headers: headers ?? (await writeHeaders(dash)) },
  );
  return { status: response.status, text: await response.text() };
}
/** @param {string} cwd @param {(dash: Awaited<ReturnType<typeof startDashboard>>) => Promise<void>} body */
async function served(cwd, body) {
  const dash = await startDashboard({ projectDir: cwd, port: 0 });
  try {
    await body(dash);
  } finally {
    await dash.close();
  }
}

test('continue puts a Run that waits for the size answer back to running and records the acceptance', async () => {
  const { cwd, id } = waitingForSize();
  await served(cwd, async (dash) => {
    assert.deepEqual(await answer(dash, id, 'continue'), { status: 200, text: 'continued' });
    const record = read(cwd, id);
    assert.equal(record.status, 'running');
    assert.equal(record.waiting_on_human, false);
    assert.equal(record.waiting_reason, '');
    assert.ok(record.size_accepted, 'the acceptance is recorded');
    assert.ok(readEvents(join(cwd, '.factory', 'runs', id)).events.some((e) => e.type === 'size-accepted'));
    assert.equal((await answer(dash, id, 'continue')).status, 409, 'the Run no longer waits');
  });
});

test('continue refuses a Run in another state or with another reason and changes nothing', async () => {
  const cases = [
    waitingForSize({ waiting_reason: 'Something else' }),
    waitingForSize({ status: 'running', waiting_on_human: false, waiting_reason: '' }),
    waitingForSize({ stage: 'check' }),
    waitingForSize({ waiting_on_human: false }),
  ];
  for (const { cwd, id } of cases) {
    const before = readFileSync(file(cwd, id), 'utf8');
    await served(cwd, async (dash) => {
      const result = await answer(dash, id, 'continue');
      assert.equal(result.status, 409);
      assert.match(result.text, /Run size/);
    });
    assert.equal(readFileSync(file(cwd, id), 'utf8'), before);
  }
});

test('continue refuses a missing, repeated or stale updated and changes nothing', async () => {
  const { cwd, id } = waitingForSize();
  const before = readFileSync(file(cwd, id), 'utf8');
  await served(cwd, async (dash) => {
    const stamp = encodeURIComponent(await updatedOf(dash, id));
    const missing = await answer(dash, id, 'continue', '');
    assert.equal(missing.status, 409);
    assert.match(missing.text, /must name the Run record time/);
    const stale = await answer(dash, id, 'continue', '?updated=2000-01-01T00%3A00%3A00.000Z');
    assert.equal(stale.status, 409);
    assert.match(stale.text, /changed since/);
    assert.equal((await answer(dash, id, 'continue', `?updated=${stamp}&updated=${stamp}`)).status, 400);
    assert.equal((await answer(dash, 'nope', 'continue')).status, 404);
  });
  assert.equal(readFileSync(file(cwd, id), 'utf8'), before);
});

test('continue refuses a request without the session token, with a wrong one or from another Origin', async () => {
  const { cwd, id } = waitingForSize();
  await served(cwd, async (dash) => {
    const query = `?updated=${encodeURIComponent(await updatedOf(dash, id))}`;
    const good = await writeHeaders(dash);
    /** @type {Record<string, string>[]} */
    const refused = [
      {},
      { Origin: good.Origin },
      { ...good, 'X-Factory-Token': 'wrong' },
      { ...good, Origin: 'https://evil.example' },
      { 'X-Factory-Token': good['X-Factory-Token'] },
    ];
    for (const headers of refused)
      assert.equal(
        (await answer(dash, id, 'continue', query, headers)).status,
        403,
        JSON.stringify(Object.keys(headers)),
      );
    assert.equal(read(cwd, id).status, 'waiting');
    assert.equal((await answer(dash, id, 'continue', query)).status, 200);
  });
});

const HAND_OVER = 'Split done: ready for an agent';

test('split keeps the done Tickets, hands the Run to an agent and answers with the moved links', async () => {
  const { cwd, id } = waitingForSize();
  await served(cwd, async (dash) => {
    assert.deepEqual(await answer(dash, id, 'split'), { status: 200, text: 't2\nt3\nt4' });
    const record = read(cwd, id);
    assert.deepEqual([record.tickets, record.tickets_done, record.tickets_total], [['t1'], 1, 1]);
    assert.deepEqual([record.status, record.waiting_on_human, record.waiting_reason], ['waiting', false, HAND_OVER]);
    const split = readEvents(join(cwd, '.factory', 'runs', id)).events.find((e) => e.type === 'split');
    assert.deepEqual(split?.moved, ['t2', 't3', 't4']);
    assert.equal((await answer(dash, id, 'split')).status, 409, 'the Run no longer waits for the size answer');
    const view = (await viewsOf(dash)).find((r) => r.id === id);
    assert.equal(view?.reason, HAND_OVER);
  });
});

test(
  'split prints a link with control and format characters with spaces, one line per link',
  { skip: process.platform === 'win32' && 'needs control characters in a link' },
  async () => {
    const evil = ['a\nb\r\nc\u2028d\u2029e\u202ef\u2066g\u2069h\u0007i\u009fj', 'ok'];
    const { cwd, id } = waitingForSize({}, ['t1', ...evil]);
    await served(cwd, async (dash) => {
      const result = await answer(dash, id, 'split');
      assert.equal(result.status, 200);
      assert.deepEqual(result.text.split('\n'), ['a b  c d e f g h i j', 'ok']);
    });
  },
);

test('split refuses what continue refuses and changes nothing', async () => {
  const cases = [
    waitingForSize({ waiting_reason: 'Something else' }),
    waitingForSize({ status: 'running', waiting_on_human: false, waiting_reason: '' }),
    waitingForSize({ stage: 'check' }),
  ];
  for (const { cwd, id } of cases) {
    const before = readFileSync(file(cwd, id), 'utf8');
    await served(cwd, async (dash) => {
      assert.equal((await answer(dash, id, 'split')).status, 409);
    });
    assert.equal(readFileSync(file(cwd, id), 'utf8'), before);
  }
  const { cwd, id } = waitingForSize();
  const before = readFileSync(file(cwd, id), 'utf8');
  await served(cwd, async (dash) => {
    const stamp = encodeURIComponent(await updatedOf(dash, id));
    assert.equal((await answer(dash, id, 'split', '')).status, 409);
    assert.equal((await answer(dash, id, 'split', '?updated=2000-01-01T00%3A00%3A00.000Z')).status, 409);
    assert.equal((await answer(dash, id, 'split', `?updated=${stamp}&updated=${stamp}`)).status, 400);
    for (const headers of /** @type {Record<string, string>[]} */ ([{}, { Origin: 'https://evil.example' }]))
      assert.equal((await answer(dash, id, 'split', `?updated=${stamp}`, headers)).status, 403);
  });
  assert.equal(readFileSync(file(cwd, id), 'utf8'), before);
});

test('the store refuses a split for a Run that changed since it was shown', () => {
  const { cwd, id } = waitingForSize();
  const store = openRunStore(cwd);
  assert.throws(() => store.split(id, { updated: '2000-01-01T00:00:00.000Z', handOver: true }), /changed since/);
  assert.equal(read(cwd, id).tickets?.length, 4);
});

test('split answers many long links with one line each, and zero-width characters become spaces', async () => {
  const links = Array.from({ length: 500 }, (_, n) => `https://example.test/${n}/${'x'.repeat(2000)}\u200b\ufeff`);
  const { cwd, id } = waitingForSize({}, ['t1', ...links]);
  await served(cwd, async (dash) => {
    const result = await answer(dash, id, 'split');
    assert.equal(result.status, 200);
    const lines = result.text.split('\n');
    assert.equal(lines.length, 500);
    assert.ok(lines.every((line) => /^https:\/\/example\.test\/\d+\/x{2000} {2}$/.test(line)));
  });
});

test('the store refuses size --accept with a stale updated and changes nothing', () => {
  const { cwd, id } = waitingForSize();
  const before = readFileSync(file(cwd, id), 'utf8');
  assert.throws(
    () => openRunStore(cwd).size(id, { accept: true, updated: '2000-01-01T00:00:00.000Z' }),
    /changed since it was shown/,
  );
  assert.equal(readFileSync(file(cwd, id), 'utf8'), before);
  openRunStore(cwd).size(id, { accept: true, updated: read(cwd, id).updated });
  assert.equal(read(cwd, id).status, 'running');
});

test('the Dashboard handlers import only the store, never run-size.js (ADR 0012)', () => {
  const source = readFileSync(new URL('../src/dashboard-handlers.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from '\.\/run-size\.js'/);
});
