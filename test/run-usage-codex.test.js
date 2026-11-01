import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repo } from './git-repo.js';
import { world, codexSession, codexMention, codexUsage } from './usage-fixtures.js';

const find = (record, match) =>
  record.metrics.usage.rows.find((r) => Object.entries(match).every(([k, v]) => r[k] === v));

test('Codex Usage: input excludes the cached part, which is shown as cache read, and reasoning stays part of output', () => {
  const w = world('codex');
  const cwd = repo();
  const id = w.start(cwd);
  const s = codexSession(w.home, { id: 'thread-a' });
  s.add(codexMention(id), codexUsage(s.turn, 'r1', { input: 1000, cached: 800, output: 50, reasoning: 20 }));
  w.update(cwd, id, { spec_link: 's.md', tickets: ['1'], tickets_total: 1 });
  w.move(cwd, id, 'build');
  const row = find(w.read(cwd, id), { stage: 'define' });
  assert.equal(row.model, 'gpt-6.1-sol');
  assert.equal(row.input, 200);
  assert.equal(row.cache_read, 800);
  assert.equal(row.output, 50);
  assert.equal(row.reasoning, 20);
  assert.match(
    w.command(cwd, 'stats', '--id', id),
    /Define · gpt-6\.1-sol {2}fresh 250 {2}input 200 {2}cache read 800 {2}cache write 0 {2}output 50 {2}of which reasoning 20/,
  );
});

test('Codex Usage: a subagent rollout of the same root session counts, a repeated response counts once', () => {
  const w = world('codex');
  const cwd = repo();
  const id = w.start(cwd);
  const main = codexSession(w.home, { id: 'thread-a' });
  const sub = codexSession(w.home, { id: 'thread-b', rootId: 'thread-a', subagent: true, model: 'gpt-6.1-mini' });
  main.add(
    codexMention(id),
    codexUsage(main.turn, 'r1', { input: 100, output: 10 }),
    codexUsage(main.turn, 'r1', { input: 100, output: 10 }),
  );
  sub.add(codexUsage(sub.turn, 's1', { input: 40, output: 4 }));
  w.update(cwd, id, { spec_link: 's.md', tickets: ['1'], tickets_total: 1 });
  w.move(cwd, id, 'build');
  const record = w.read(cwd, id);
  assert.equal(find(record, { model: 'gpt-6.1-sol' }).input, 100);
  assert.equal(find(record, { model: 'gpt-6.1-mini' }).subagent_fresh, 44);
});

test('Codex Usage: two Runs never mix, and an unknown format is not tracked without failing the transition', () => {
  const w = world('codex');
  const cwd = repo();
  const one = w.start(cwd, 'One');
  const two = w.start(cwd, 'Two');
  const a = codexSession(w.home, { id: 'thread-a' });
  const b = codexSession(w.home, { id: 'thread-b' });
  a.add(codexMention(one), codexUsage(a.turn, 'a1', { input: 11 }));
  b.add(codexMention(two), '{"type":"token_usage_record","payload":{"usage":"weird"}}', 'garbage');
  for (const id of [one, two]) w.update(cwd, id, { spec_link: 's.md', tickets: ['1'], tickets_total: 1 });
  w.move(cwd, one, 'build');
  w.move(cwd, two, 'build');
  assert.equal(find(w.read(cwd, one), { stage: 'define' }).input, 11);
  const second = w.read(cwd, two);
  assert.equal(second.stage, 'build');
  assert.equal(second.metrics.usage.status, 'not tracked');
  assert.match(second.metrics.usage.reason, /no usage found.*Codex/);
});
