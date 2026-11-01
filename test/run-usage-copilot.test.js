import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repo } from './git-repo.js';
import { world, copilotSession, copilotMention, copilotUsage } from './usage-fixtures.js';

const find = (record, match) =>
  record.metrics.usage.rows.find((r) => Object.entries(match).every(([k, v]) => r[k] === v));

test('Copilot Usage: cache reads and writes are taken out of input, and reasoning stays part of output', () => {
  const w = world('copilot');
  const cwd = repo();
  const id = w.start(cwd);
  const s = copilotSession(w.home, 'session-a');
  s.add(
    copilotMention(id),
    copilotUsage('c1', { input: 1000, cacheRead: 600, cacheWrite: 300, output: 50, reasoning: 20 }),
  );
  w.update(cwd, id, { spec_link: 's.md', tickets: ['1'], tickets_total: 1 });
  w.move(cwd, id, 'build');
  const row = find(w.read(cwd, id), { stage: 'define' });
  assert.deepEqual(
    [row.model, row.input, row.cache_read, row.cache_write, row.output, row.reasoning],
    ['claude-sonnet-5.5', 100, 600, 300, 50, 20],
  );
  assert.match(
    w.command(cwd, 'stats', '--id', id),
    /Define · claude-sonnet-5\.5 {2}fresh 450 {2}input 100 {2}cache read 600 {2}cache write 300 {2}output 50 {2}of which reasoning 20/,
  );
});

test('Copilot Usage: sub-agent calls are counted in their Stage and model and shown as a share; a repeated call counts once', () => {
  const w = world('copilot');
  const cwd = repo();
  const id = w.start(cwd);
  const s = copilotSession(w.home, 'session-a');
  s.add(
    copilotMention(id),
    copilotUsage('c1', { input: 100, output: 10 }),
    copilotUsage('c1', { input: 100, output: 10 }),
    copilotUsage('c2', { model: 'gpt-6.1-mini', input: 40, output: 4, subagent: true }),
  );
  w.update(cwd, id, { spec_link: 's.md', tickets: ['1'], tickets_total: 1 });
  w.move(cwd, id, 'build');
  const record = w.read(cwd, id);
  assert.equal(find(record, { model: 'claude-sonnet-5.5' }).input, 100);
  assert.equal(find(record, { model: 'gpt-6.1-mini' }).subagent_fresh, 44);
});

test('Copilot Usage: two Runs never mix, and an unknown format is not tracked without failing the transition', () => {
  const w = world('copilot');
  const cwd = repo();
  const one = w.start(cwd, 'One');
  const two = w.start(cwd, 'Two');
  const a = copilotSession(w.home, 'session-a');
  const b = copilotSession(w.home, 'session-b');
  a.add(copilotMention(one), copilotUsage('a1', { input: 11 }));
  b.add(copilotMention(two), '{"type":"session.usage_record","data":{"usage":"weird"}}', 'garbage');
  for (const id of [one, two]) w.update(cwd, id, { spec_link: 's.md', tickets: ['1'], tickets_total: 1 });
  w.move(cwd, one, 'build');
  w.move(cwd, two, 'build');
  assert.equal(find(w.read(cwd, one), { stage: 'define' }).input, 11);
  const second = w.read(cwd, two);
  assert.equal(second.stage, 'build');
  assert.equal(second.metrics.usage.status, 'not tracked');
  assert.match(second.metrics.usage.reason, /no usage found.*Copilot/);
});
