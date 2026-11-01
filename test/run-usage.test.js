import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repo } from './git-repo.js';
import { world, claudeLine, mention, claudeSession } from './usage-fixtures.js';

// A Run on the Claude target driven through real transitions; fixture log lines are written between the commands,
// so their timestamps fall into the Stage visit the real operations recorded.
function twoTicketRun(w, cwd) {
  const id = w.start(cwd);
  const session = claudeSession(w.home, 'session-a');
  session.add(mention(id), claudeLine({ id: 'd1', input: 10, cacheRead: 1000, cacheWrite: 100, output: 50 }));
  w.update(cwd, id, { spec_link: 's.md', tickets: ['1', '2'], tickets_total: 2 });
  w.move(cwd, id, 'build');
  session.add(claudeLine({ id: 'b1', input: 20, cacheRead: 2000, cacheWrite: 200, output: 60 }));
  w.update(cwd, id, { tickets_done: 1 });
  session.add(claudeLine({ id: 'b2', input: 30, cacheRead: 3000, cacheWrite: 300, output: 70 }));
  w.update(cwd, id, { tickets_done: 2 });
  session.add(claudeLine({ id: 'b3', input: 5, cacheRead: 500, cacheWrite: 50, output: 15 }));
  w.move(cwd, id, 'check');
  session.add(claudeLine({ id: 'c1', model: 'claude-opus-5-5', input: 7, cacheRead: 700, cacheWrite: 70, output: 17 }));
  session.addSub(
    claudeLine({ id: 's1', model: 'claude-haiku-5-5', input: 3, cacheRead: 30, cacheWrite: 300, output: 33 }),
  );
  return { id, session };
}
const rows = (record) => record.metrics.usage.rows;
const find = (record, match) => rows(record).find((r) => Object.entries(match).every(([k, v]) => r[k] === v));

test('transitions store Usage per Stage, model, Ticket and the Build wrap-up, with subagents in their Stage', () => {
  const w = world();
  const cwd = repo();
  const { id } = twoTicketRun(w, cwd);
  w.command(cwd, 'rework', '--id', id);
  const record = w.read(cwd, id);
  assert.equal(record.metrics.usage.status, 'tracked');
  assert.deepEqual(find(record, { stage: 'define' }), {
    stage: 'define',
    model: 'claude-sonnet-5-5',
    ticket: null,
    bucket: null,
    input: 10,
    cache_read: 1000,
    cache_write: 100,
    output: 50,
    reasoning: null,
    subagent_fresh: 0,
  });
  assert.equal(find(record, { stage: 'build', ticket: 1 }).output, 60);
  assert.equal(find(record, { stage: 'build', ticket: 2 }).cache_read, 3000);
  assert.equal(find(record, { stage: 'build', bucket: 'wrap-up' }).input, 5);
  assert.equal(find(record, { stage: 'check', model: 'claude-opus-5-5' }).cache_write, 70);
  const haiku = find(record, { stage: 'check', model: 'claude-haiku-5-5' });
  assert.equal(haiku.subagent_fresh, 3 + 300 + 33);
});

test('run stats prints fresh tokens and the four fields for each row', () => {
  const w = world();
  const cwd = repo();
  const { id } = twoTicketRun(w, cwd);
  w.command(cwd, 'rework', '--id', id);
  const out = w.command(cwd, 'stats', '--id', id);
  assert.match(out, /Tokens: 1\.3k fresh/);
  assert.match(
    out,
    /Define · claude-sonnet-5-5 {2}fresh 160 {2}input 10 {2}cache read 1\.0k {2}cache write 100 {2}output 50/,
  );
  assert.match(out, /Build · Ticket 1 · claude-sonnet-5-5 {2}fresh 280/);
  assert.match(out, /Build · wrap-up · claude-sonnet-5-5 {2}fresh 70/);
  assert.match(out, /Check · claude-haiku-5-5 {2}fresh 336 .*subagents 336/);
});

test('Build after a Rework goes to the Rework bucket, not to a Ticket', () => {
  const w = world();
  const cwd = repo();
  const { id, session } = twoTicketRun(w, cwd);
  w.command(cwd, 'rework', '--id', id);
  session.add(claudeLine({ id: 'r1', input: 4, cacheRead: 40, cacheWrite: 4, output: 4 }));
  w.move(cwd, id, 'check');
  const record = w.read(cwd, id);
  assert.equal(find(record, { stage: 'build', bucket: 'rework' }).input, 4);
  assert.equal(find(record, { stage: 'build', ticket: 2 }).input, 30);
});

test('two Runs started from the same folder never mix, and reading twice gives the same numbers', () => {
  const w = world();
  const cwd = repo();
  const one = w.start(cwd, 'One');
  const two = w.start(cwd, 'Two');
  const a = claudeSession(w.home, 'session-a');
  const b = claudeSession(w.home, 'session-b');
  a.add(mention(one), claudeLine({ id: 'a1', input: 11 }));
  b.add(mention(two), claudeLine({ id: 'b1', input: 22 }));
  w.update(cwd, one, { spec_link: 's.md', tickets: ['1'], tickets_total: 1 });
  w.update(cwd, two, { spec_link: 's.md', tickets: ['1'], tickets_total: 1 });
  w.move(cwd, one, 'build');
  w.move(cwd, two, 'build');
  assert.deepEqual(
    rows(w.read(cwd, one)).map((r) => r.input),
    [11],
  );
  assert.deepEqual(
    rows(w.read(cwd, two)).map((r) => r.input),
    [22],
  );
  w.update(cwd, one, { tickets_done: 1 });
  w.move(cwd, one, 'check');
  const first = JSON.stringify(rows(w.read(cwd, one)));
  w.command(cwd, 'rework', '--id', one);
  w.move(cwd, one, 'check');
  assert.deepEqual(
    rows(w.read(cwd, one)).filter((r) => r.stage === 'define'),
    JSON.parse(first).filter((r) => r.stage === 'define'),
  );
});

test('a Run resumed in a second session counts both sessions', () => {
  const w = world();
  const cwd = repo();
  const id = w.start(cwd);
  const a = claudeSession(w.home, 'session-a');
  const b = claudeSession(w.home, 'session-b', '-other-slug');
  a.add(mention(id), claudeLine({ id: 'a1', input: 1 }));
  w.update(cwd, id, { spec_link: 's.md', tickets: ['1'], tickets_total: 1 });
  b.add(mention(id), claudeLine({ id: 'b1', input: 2 }));
  w.move(cwd, id, 'build');
  const record = w.read(cwd, id);
  assert.equal(find(record, { stage: 'define' }).input, 3);
  assert.deepEqual(record.metrics.usage.sessions.sort(), ['session-a', 'session-b']);
});

test('a missing, truncated or unknown log never fails a transition and shows not tracked with a reason', () => {
  const w = world();
  const cwd = repo();
  const id = w.start(cwd);
  w.update(cwd, id, { spec_link: 's.md', tickets: ['1'], tickets_total: 1 });
  w.move(cwd, id, 'build');
  let record = w.read(cwd, id);
  assert.equal(record.metrics.usage.status, 'not tracked');
  assert.match(record.metrics.usage.reason, /no Claude session logs/);
  const session = claudeSession(w.home, 'session-a');
  session.add(
    mention(id),
    '{"type":"assistant","message":{"usage":',
    'not json at all',
    JSON.stringify({ type: 'assistant', message: { model: 'm', usage: 'weird' } }),
  );
  w.update(cwd, id, { tickets_done: 1 });
  w.move(cwd, id, 'check');
  record = w.read(cwd, id);
  assert.equal(record.stage, 'check');
  assert.equal(record.metrics.usage.status, 'not tracked');
  assert.match(w.command(cwd, 'stats', '--id', id), /Tokens: not tracked \(no usage found/);
});

test('earlier Usage survives when the logs are gone, and a legacy record stays readable', () => {
  const w = world();
  const cwd = repo();
  const { id } = twoTicketRun(w, cwd);
  w.command(cwd, 'rework', '--id', id);
  const before = JSON.stringify(rows(w.read(cwd, id)));
  rmSync(join(w.home, '.claude'), { recursive: true });
  w.move(cwd, id, 'check');
  assert.equal(JSON.stringify(rows(w.read(cwd, id))), before);
  const file = join(cwd, '.factory', 'runs', id, 'run.json');
  const legacy = JSON.parse(readFileSync(file, 'utf8'));
  legacy.metrics.usage = { tokens: 'not tracked', cost: 'not tracked' };
  writeFileSync(file, JSON.stringify(legacy));
  assert.match(w.command(cwd, 'stats', '--id', id), /Tokens: not tracked/);
});

test('only counts reach the Run record, never conversation text', () => {
  const w = world();
  const cwd = repo();
  const id = w.start(cwd);
  const session = claudeSession(w.home, 'session-a');
  session.add(mention(id), claudeLine({ id: 'x1', text: 'SECRET-CONVERSATION-TEXT' }));
  w.update(cwd, id, { spec_link: 's.md', tickets: ['1'], tickets_total: 1 });
  w.move(cwd, id, 'build');
  assert.equal(w.read(cwd, id).metrics.usage.status, 'tracked');
  const everything =
    readFileSync(join(cwd, '.factory', 'runs', id, 'run.json'), 'utf8') +
    readFileSync(join(cwd, '.factory', 'runs', id, 'events.jsonl'), 'utf8');
  assert.doesNotMatch(everything, /SECRET-CONVERSATION-TEXT/);
});

test('the Claude session id the CLI sees is recorded and matches a transcript that never names the Run', () => {
  const w = world();
  w.sessionId = 'session-exact';
  const cwd = repo();
  const id = w.start(cwd);
  const session = claudeSession(w.home, 'session-exact');
  session.add(claudeLine({ id: 'e1', input: 9 }));
  w.update(cwd, id, { spec_link: 's.md', tickets: ['1'], tickets_total: 1 });
  w.move(cwd, id, 'build');
  const record = w.read(cwd, id);
  assert.deepEqual(record.metrics.sessions, ['session-exact']);
  assert.equal(find(record, { stage: 'define' }).input, 9);
});

test('run stats --all adds the tokens per model of tracked Runs and names the Runs it leaves out', () => {
  const w = world();
  const cwd = repo();
  const one = w.start(cwd, 'One');
  const two = w.start(cwd, 'Two');
  const three = w.start(cwd, 'Three');
  const a = claudeSession(w.home, 'session-a');
  const b = claudeSession(w.home, 'session-b');
  a.add(mention(one), claudeLine({ id: 'a1', input: 10, cacheRead: 100, cacheWrite: 20, output: 5 }));
  b.add(
    mention(two),
    claudeLine({ id: 'b1', input: 1, cacheRead: 10, cacheWrite: 2, output: 3 }),
    claudeLine({ id: 'b2', model: 'claude-opus-5-5', input: 7, output: 7 }),
  );
  for (const id of [one, two, three]) w.update(cwd, id, { spec_link: 's.md', tickets: ['1'], tickets_total: 1 });
  for (const id of [one, two, three]) w.move(cwd, id, 'build');
  const out = w.command(cwd, 'stats', '--all');
  assert.match(out, /Token usage of 2 tracked Run\(s\)/);
  assert.match(out, /claude-sonnet-5-5 {2}fresh 41 {2}input 11 {2}cache read 110 {2}cache write 22 {2}output 8/);
  assert.match(out, /claude-opus-5-5 {2}fresh 14 {2}input 7 /);
  assert.match(out, new RegExp(`Left out of the token totals \\(not tracked\\): ${three}`));
});

// Session logs are written by other programs, so what they hold is untrusted text.
test('hostile logs: a model name with control characters, a symlinked transcript, very deep nesting and a very long line', () => {
  const w = world();
  const cwd = repo();
  const id = w.start(cwd);
  const session = claudeSession(w.home, 'session-a');
  const deep = '['.repeat(100000) + ']'.repeat(100000);
  session.add(
    mention(id),
    claudeLine({ id: 'e1', model: 'evil\u001b[31m\u0007model', input: 5 }),
    claudeLine({ id: 'ok', model: 'claude-sonnet-5-5', input: 7 }),
    `{"usage":${deep}}`,
    `{"message":{"usage":{"input_tokens":1}},"pad":"${'x'.repeat(5 * 1024 * 1024)}"}`,
  );
  // A symlink in the subagent folder that points at a file outside the logs must not be read.
  const outside = join(w.home, 'outside.jsonl');
  writeFileSync(outside, claudeLine({ id: 'out', input: 999999 }) + '\n');
  symlinkSync(
    outside,
    join(w.home, '.claude', 'projects', '-home-user-project', 'session-a', 'subagents', 'link.jsonl'),
  );
  w.update(cwd, id, { spec_link: 's.md', tickets: ['1'], tickets_total: 1 });
  w.move(cwd, id, 'build');
  const record = w.read(cwd, id);
  assert.deepEqual(
    rows(record).map((r) => [r.model, r.input]),
    [['claude-sonnet-5-5', 7]],
  );
  const out = w.command(cwd, 'stats', '--id', id);
  assert.doesNotMatch(out, /[\u0000-\u0008\u000b-\u001f\u007f]/);
});

test('the Run record holds a bounded number of Usage rows', () => {
  const w = world();
  const cwd = repo();
  const id = w.start(cwd);
  const session = claudeSession(w.home, 'session-a');
  session.add(
    mention(id),
    ...Array.from({ length: 700 }, (_, i) => claudeLine({ id: `m${i}`, model: `model-${i}`, input: 1 })),
  );
  w.update(cwd, id, { spec_link: 's.md', tickets: ['1'], tickets_total: 1 });
  w.move(cwd, id, 'build');
  assert.equal(rows(w.read(cwd, id)).length, 500);
});

test('reading stops at its time budget and reports it, instead of holding the transition', async () => {
  const { readUsage } = await import('../src/run-usage.js');
  const w = world();
  const session = claudeSession(w.home, 'session-a');
  session.add(mention('run-1'), claudeLine({ id: 'x1' }));
  const record = {
    agent: 'claude',
    created: new Date(0).toISOString(),
    metrics: { version: 1, visits: [{ stage: 'define', started: new Date(0).toISOString() }], verdicts: [] },
  };
  const late = readUsage(record, '/nowhere/run-1', { home: w.home, budgetMs: -1 });
  assert.equal(late.status, 'not tracked');
  assert.match(late.reason, /took too long/);
  const ok = readUsage(record, '/nowhere/run-1', { home: w.home });
  assert.equal(ok.status, 'tracked');
});

test('a field the log does not report shows n/a, and a visited Stage without entries shows no data', () => {
  const w = world();
  const cwd = repo();
  const id = w.start(cwd);
  const session = claudeSession(w.home, 'session-a');
  const bare = JSON.stringify({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: { id: 'm1', model: 'claude-sonnet-5-5', usage: { input_tokens: 4, output_tokens: 6 } },
  });
  session.add(mention(id), bare);
  w.update(cwd, id, { spec_link: 's.md', tickets: ['1'], tickets_total: 1 });
  w.move(cwd, id, 'build');
  w.update(cwd, id, { tickets_done: 1 });
  w.move(cwd, id, 'check');
  const out = w.command(cwd, 'stats', '--id', id);
  assert.match(
    out,
    /Define · claude-sonnet-5-5 {2}fresh 10 {2}input 4 {2}cache read n\/a {2}cache write n\/a {2}output 6/,
  );
  assert.match(out, /Build · no data/);
});
