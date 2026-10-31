import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openRunStore } from '../src/run-store.js';
import { readEvents } from '../src/run-events.js';
import { interpretRun } from '../src/dashboard.js';
import { repo } from './git-repo.js';

const begin = (cwd, commands = 'true') => openRunStore(cwd).start({ title: 'Events', agent: 'claude', commands, conventions: [] });
const dirOf = (cwd, id) => join(cwd, '.factory', 'runs', id);
const record = (cwd, id) => JSON.parse(readFileSync(join(dirOf(cwd, id), 'run.json'), 'utf8'));
const events = (cwd, id) => readEvents(dirOf(cwd, id));
const toBuild = (store, id) => { store.update(id, { spec_link: 's.md', tickets: ['1', '2'], tickets_total: 2 }); store.transition(id, 'build'); };

test('model fields go through update and are plain strings', () => {
  const cwd = repo(), store = openRunStore(cwd), id = begin(cwd);
  store.update(id, { requested_model: 'claude-sonnet-5.5', requested_effort: 'high', observed_model: 'claude-sonnet-5-5' });
  assert.deepEqual([record(cwd, id).requested_model, record(cwd, id).requested_effort, record(cwd, id).observed_model], ['claude-sonnet-5.5', 'high', 'claude-sonnet-5-5']);
  assert.throws(() => store.update(id, { requested_model: 5 }), /invalid field or value: requested_model/);
});

test('a transition clears the model fields of the earlier Stage and sets the requested model from the frozen settings', () => {
  const cwd = repo(), store = openRunStore(cwd), id = begin(cwd);
  store.update(id, { requested_model: 'old', requested_effort: 'low', observed_model: 'old' });
  toBuild(store, id);
  const r = record(cwd, id);
  assert.equal(r.requested_model, undefined);
  assert.equal(r.requested_effort, undefined);
  assert.equal(r.observed_model, undefined);
  writeFileSync(join(dirOf(cwd, id), 'run.json'), JSON.stringify({ ...r, project_config: { ...r.project_config, models: { check: 'claude-opus-5.5' } } }));
  store.update(id, { tickets_done: 2 });
  store.transition(id, 'check');
  assert.equal(record(cwd, id).requested_model, 'claude-opus-5.5');
  assert.equal(record(cwd, id).observed_model, undefined);
});

test('every write refreshes last_seen', async () => {
  const cwd = repo(), store = openRunStore(cwd), id = begin(cwd);
  const first = record(cwd, id).last_seen;
  assert.ok(Date.parse(first));
  await new Promise((r) => setTimeout(r, 5));
  store.update(id, { activity: 'still here' });
  const second = record(cwd, id).last_seen;
  assert.ok(Date.parse(second) > Date.parse(first));
  await new Promise((r) => setTimeout(r, 5));
  toBuild(store, id);
  assert.ok(Date.parse(record(cwd, id).last_seen) > Date.parse(second));
});

test('the store appends Stage, Ticket, waiting, release and Rework events, and Verify start and finish with a duration', () => {
  const cwd = repo(), store = openRunStore(cwd), id = begin(cwd);
  toBuild(store, id);
  store.update(id, { tickets_done: 1 });
  store.update(id, { status: 'waiting', waiting_reason: 'answer' });
  store.update(id, { status: 'running' });
  store.update(id, { tickets_done: 2 });
  store.verify(id);
  store.verify(id, { fast: false });
  store.transition(id, 'check');
  store.verdict(id, 'standards', 'fail');
  store.rework(id);
  const { events: log, damaged } = events(cwd, id);
  assert.equal(damaged, 0);
  const types = log.map((e) => e.type);
  assert.deepEqual(types.filter((t) => t !== 'verify-start' && t !== 'verify'), ['stage', 'ticket-done', 'waiting', 'released', 'ticket-done', 'stage', 'rework', 'stage']);
  assert.deepEqual(log.filter((e) => e.type === 'stage').map((e) => [e.from, e.to]), [['define', 'build'], ['build', 'check'], ['check', 'build']]);
  assert.equal(log.find((e) => e.type === 'waiting').reason, 'answer');
  const finish = log.find((e) => e.type === 'verify');
  assert.equal(finish.exit_code, 0);
  assert.ok(Number.isInteger(finish.duration_ms) && finish.duration_ms >= 0);
  assert.equal(log.filter((e) => e.type === 'verify-start').length, 2);
  for (const e of log) assert.ok(Date.parse(e.at), JSON.stringify(e));
});

test('a fast Verify appends events marked fast and records no Evidence', () => {
  const cwd = repo(), store = openRunStore(cwd);
  const id = openRunStore(cwd).start({ title: 'Fast', agent: 'claude', commands: 'true', fast_commands: 'true', conventions: [] });
  toBuild(store, id);
  store.verify(id, { fast: true });
  const fast = events(cwd, id).events.filter((e) => e.type === 'verify');
  assert.equal(fast.length, 1);
  assert.equal(fast[0].fast, true);
  assert.equal(record(cwd, id).verify, undefined);
});

test('the log is append-only and an unreadable line is skipped and counted', () => {
  const cwd = repo(), store = openRunStore(cwd), id = begin(cwd);
  toBuild(store, id);
  const file = join(dirOf(cwd, id), 'events.jsonl');
  const before = readFileSync(file, 'utf8');
  writeFileSync(file, `${before}{broken\n["not an object"]\n{"at":"2026-01-01T00:00:00.000Z"}\n`);
  store.update(id, { tickets_done: 1 });
  const text = readFileSync(file, 'utf8');
  assert.ok(text.startsWith(before), 'earlier lines are untouched');
  const { events: log, damaged } = events(cwd, id);
  assert.equal(damaged, 3);
  assert.deepEqual(log.map((e) => e.type), ['stage', 'ticket-done']);
});

test('a symlinked log is refused for reading and writing, and the operation still succeeds', () => {
  const cwd = repo(), store = openRunStore(cwd), id = begin(cwd);
  const target = join(cwd, 'elsewhere.txt');
  writeFileSync(target, 'keep\n');
  rmSync(join(dirOf(cwd, id), 'events.jsonl'), { force: true });
  symlinkSync(target, join(dirOf(cwd, id), 'events.jsonl'));
  toBuild(store, id);
  assert.equal(readFileSync(target, 'utf8'), 'keep\n');
  assert.equal(record(cwd, id).stage, 'build');
  assert.deepEqual(events(cwd, id), { events: [], damaged: 0, unreadable: true });
});

test('a large log is read from its end', () => {
  const cwd = repo(), id = begin(cwd);
  const line = `${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', type: 'status', status: 'x'.repeat(200) })}\n`;
  writeFileSync(join(dirOf(cwd, id), 'events.jsonl'), line.repeat(5000));
  const { events: log, damaged } = events(cwd, id);
  assert.ok(log.length > 0 && log.length < 5000);
  assert.equal(damaged, 0, 'the cut first line is not counted as damage');
});

test('an old Run without the fields or a log loads, with unknown values empty', () => {
  const cwd = repo(), id = begin(cwd);
  const old = record(cwd, id);
  for (const key of ['last_seen', 'requested_model', 'requested_effort', 'observed_model']) delete old[key];
  rmSync(join(dirOf(cwd, id), 'events.jsonl'), { force: true });
  const view = interpretRun({ id, record: old, files: [], events: undefined });
  assert.deepEqual(view.model, { requested: '', effort: '', observed: '' });
  assert.equal(view.lastSeen, '');
  assert.deepEqual(view.events, []);
  assert.equal(view.eventsDamaged, 0);
  assert.deepEqual(events(cwd, id), { events: [], damaged: 0 });
});

test('interpretRun exposes the model, last seen and events without calling a request a confirmation', () => {
  const view = interpretRun({ id: 'r', files: [], record: { status: 'running', stage: 'build', requested_model: 'm1', requested_effort: 'high', last_seen: '2026-01-01T00:00:00.000Z' }, events: { events: [{ at: '2026-01-01T00:00:00.000Z', type: 'stage', from: 'define', to: 'build' }], damaged: 2 } });
  assert.deepEqual(view.model, { requested: 'm1', effort: 'high', observed: '' });
  assert.equal(view.lastSeen, '2026-01-01T00:00:00.000Z');
  assert.equal(view.events.length, 1);
  assert.equal(view.eventsDamaged, 2);
});

test('a Rework clears the model of the Check worker and asks for the configured one for Build', () => {
  const cwd = repo(), store = openRunStore(cwd), id = begin(cwd);
  toBuild(store, id);
  const r = record(cwd, id);
  writeFileSync(join(dirOf(cwd, id), 'run.json'), JSON.stringify({ ...r, project_config: { ...r.project_config, models: { build: 'claude-sonnet-5.5' } } }));
  store.update(id, { tickets_done: 2 });
  store.transition(id, 'check');
  store.update(id, { requested_model: 'reviewer', requested_effort: 'high', observed_model: 'reviewer' });
  store.rework(id);
  const after = record(cwd, id);
  assert.equal(after.stage, 'build');
  assert.equal(after.requested_model, 'claude-sonnet-5.5');
  assert.equal(after.requested_effort, undefined);
  assert.equal(after.observed_model, undefined);
});

test('other status changes become status events and a release only follows a wait', () => {
  const cwd = repo(), store = openRunStore(cwd), id = begin(cwd);
  store.update(id, { status: 'interrupted', status_reason: 'closed laptop' });
  store.update(id, { status: 'running' });
  store.update(id, { status: 'abandoned' });
  assert.deepEqual(events(cwd, id).events.map((e) => [e.type, e.status]), [['status', 'interrupted'], ['status', 'running'], ['status', 'abandoned']]);
});

test('a store operation works on an old record without last_seen or a log, and then adds them', () => {
  const cwd = repo(), store = openRunStore(cwd), id = begin(cwd);
  const old = record(cwd, id);
  delete old.last_seen;
  writeFileSync(join(dirOf(cwd, id), 'run.json'), JSON.stringify(old));
  rmSync(join(dirOf(cwd, id), 'events.jsonl'), { force: true });
  store.update(id, { activity: 'back' });
  assert.ok(Date.parse(record(cwd, id).last_seen));
  toBuild(store, id);
  assert.equal(events(cwd, id).events[0].type, 'stage');
});

test('a FIFO or a hard link as the log is neither read nor written through', async () => {
  const { execFileSync } = await import('node:child_process');
  const { linkSync } = await import('node:fs');
  const cwd = repo(), store = openRunStore(cwd), id = begin(cwd);
  const log = join(dirOf(cwd, id), 'events.jsonl');
  rmSync(log, { force: true });
  execFileSync('mkfifo', [log]);
  toBuild(store, id);
  assert.equal(record(cwd, id).stage, 'build');
  assert.equal(events(cwd, id).unreadable, true);
  rmSync(log);
  const target = join(cwd, 'other.txt');
  writeFileSync(target, 'keep\n');
  linkSync(target, log);
  store.update(id, { tickets_done: 1 });
  assert.equal(readFileSync(target, 'utf8'), 'keep\n');
  assert.equal(events(cwd, id).unreadable, true);
});

test('the view keeps only the last 50 events', () => {
  const all = Array.from({ length: 80 }, (_, i) => ({ at: '2026-01-01T00:00:00.000Z', type: 'ticket-done', done: i, total: 80 }));
  const view = interpretRun({ id: 'r', files: [], record: { status: 'running', stage: 'build' }, events: { events: all, damaged: 0 } });
  assert.equal(view.events.length, 50);
  assert.equal(view.events[0].done, 30);
});

test('the Skill tells agents to report the model once per Stage, and the schema lists the new fields', () => {
  const root = join(import.meta.dirname, '..', 'skills', 'factory');
  const skill = readFileSync(join(root, 'SKILL.md'), 'utf8');
  assert.match(skill, /Set `activity` on every update, and often\. Once per Stage report `requested_model`, `requested_effort` and, if you can see it, `observed_model`/);
  const schema = readFileSync(join(root, 'references', 'run-schema.md'), 'utf8');
  for (const field of ['requested_model', 'requested_effort', 'observed_model', 'last_seen']) assert.match(schema, new RegExp(`\\| \`${field}\` \\|`));
});
