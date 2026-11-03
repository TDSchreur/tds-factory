import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDashboard } from '../src/dashboard.js';
import { writeHeaders } from './dashboard-token.js';
import { envWith } from './fake-command.js';
import { git } from './git-repo.js';
import { fixture, run } from './follow-up-fixture.js';
import { viewsOf } from './run-view.js';

// The Dashboard process of these tests is this one, so the fake `gh` goes on its PATH.
const saved = { ...process.env };
after(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

/** @param {ReturnType<typeof fixture>} f */
async function withFix(f) {
  Object.assign(process.env, envWith(join(f.cwd, 'fake-bin'), { FAKE_GH: join(f.cwd, 'gh.json') }));
  const dash = await startDashboard({ projectDir: f.cwd, port: 0 });
  /** @param {string} [query] @param {Record<string, string>} [headers] */
  const fix = async (query, headers) => {
    const view = (await viewsOf(dash)).find((r) => r.id === f.id);
    const q = query ?? `?scope=checks&updated=${encodeURIComponent(view?.updated ?? '')}`;
    const res = await fetch(`${dash.url}/api/projects/${dash.projectId}/runs/${f.id}/follow-up${q}`, {
      method: 'POST',
      headers: headers ?? (await writeHeaders(dash)),
    });
    return { status: res.status, text: await res.text() };
  };
  const view = async () => (await viewsOf(dash)).find((r) => r.id === f.id);
  return { dash, fix, view };
}
const WAITING = 'Follow-up Rework ready for an agent';

test('a Fix starts the scoped Rework and leaves the Run waiting for an agent, keeping the snapshot', async () => {
  const f = fixture();
  const { dash, fix, view } = await withFix(f);
  try {
    const answer = await fix();
    assert.equal(answer.status, 200, answer.text);
    const record = f.read();
    assert.equal(record.stage, 'build');
    assert.equal(record.status, 'waiting');
    assert.equal(record.waiting_reason, WAITING);
    assert.equal(record.waiting_on_human, false);
    assert.equal(record.follow_up?.scope, 'checks');
    assert.equal(record.follow_up?.failures[0].name, 'unit');
    assert.equal(record.check_loops, 1);
    const v = await view();
    assert.deepEqual([v?.reworkInProgress, v?.waiting, v?.reason, v?.column], [true, true, WAITING, 'build']);
  } finally {
    await dash.close();
  }
});

test('a Fix is refused without the session token and with a foreign Origin', async () => {
  const f = fixture();
  const { dash, fix } = await withFix(f);
  try {
    const own = await writeHeaders(dash);
    assert.equal((await fix(undefined, { Origin: dash.url })).status, 403);
    assert.equal((await fix(undefined, { ...own, Origin: 'http://evil.example' })).status, 403);
    assert.equal(f.read().stage, 'finish');
  } finally {
    await dash.close();
  }
});

test('a Fix is refused for a stale record time and for a second Rework, with how to go on', async () => {
  const f = fixture();
  const { dash, fix } = await withFix(f);
  try {
    const stale = await fix('?scope=checks&updated=2000-01-01T00%3A00%3A00.000Z');
    assert.equal(stale.status, 409);
    assert.match(stale.text, /changed since you looked at it; reload/);
    assert.equal((await fix('?scope=checks')).status, 409, 'updated is required');
    assert.equal(f.read().stage, 'finish');
    assert.equal((await fix()).status, 200);
    const second = await fix();
    assert.equal(second.status, 409);
    assert.match(second.text, /Rework is already in progress; finish it in Build and Check first/);
  } finally {
    await dash.close();
  }
});

test('a dirty worktree, a head that differs and a cleaned worktree are refused with the way out', async () => {
  const f = fixture();
  const { dash, fix } = await withFix(f);
  const worktree = f.read().worktree;
  try {
    writeFileSync(join(worktree, 'dirty.txt'), 'x\n');
    const dirty = await fix();
    assert.equal(dirty.status, 409);
    assert.match(dirty.text, /uncommitted changes; commit or discard them/);
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-q', '-m', 'local');
    const head = await fix();
    assert.equal(head.status, 409);
    assert.match(head.text, /head differs from the PR head; push the Run commits or pull/);
    git(f.cwd, 'worktree', 'remove', '--force', worktree);
    const cleaned = await fix();
    assert.equal(cleaned.status, 409);
    assert.match(cleaned.text, /cleaned; start a new Run/);
    assert.equal(f.read().stage, 'finish');
    assert.equal(f.read().status, 'done');
  } finally {
    await dash.close();
  }
});

test('a scope without findings and an unknown scope start nothing', async () => {
  const f = fixture();
  const { dash, fix } = await withFix(f);
  try {
    const none = await fix(`?scope=conflicts&updated=${encodeURIComponent(f.read().updated ?? '')}`);
    assert.equal(none.status, 409);
    assert.match(none.text, /no conflicts findings/);
    assert.notEqual(f.read().status, 'waiting');
    assert.equal(f.read().stage, 'follow-up');
    assert.equal((await fix('?scope=everything&updated=x')).status, 400);
    assert.equal((await fix('?updated=x')).status, 400);
  } finally {
    await dash.close();
  }
});

test('an Azure DevOps pull request is refused', async () => {
  const f = fixture();
  writeFileSync(f.file, JSON.stringify({ ...f.read(), pr: 'https://dev.azure.com/o/p/_git/r/pullrequest/7' }));
  const { dash, fix } = await withFix(f);
  try {
    const answer = await fix();
    assert.equal(answer.status, 409);
    assert.match(answer.text, /GitHub pull requests only/);
  } finally {
    await dash.close();
  }
});

/** @param {ReturnType<typeof fixture>} f */
const atCap = (f) => writeFileSync(f.file, JSON.stringify({ ...f.read(), check_loops: 4 }));

test('at the limit a Fix needs the grant, which raises extra_loops once and writes the event', async () => {
  const f = fixture();
  atCap(f);
  const { dash, fix, view } = await withFix(f);
  try {
    const refused = await fix();
    assert.equal(refused.status, 409);
    assert.match(refused.text, /limit of 4 is reached; grant an extra loop/);
    assert.equal(f.read().extra_loops, undefined);
    const updated = encodeURIComponent((await view())?.updated ?? '');
    const granted = await fix(`?scope=checks&updated=${updated}&grant=true`);
    assert.equal(granted.status, 200, granted.text);
    const record = f.read();
    assert.equal(record.extra_loops, 1);
    assert.equal(record.check_loops, 5);
    assert.equal(record.stage, 'build');
    assert.equal(record.waiting_reason, WAITING);
    const events = (await view())?.events.filter((e) => e.type === 'extra-loop');
    assert.deepEqual(
      events?.map((e) => [e.granted, e.limit]),
      [[1, 5]],
    );
  } finally {
    await dash.close();
  }
});

test('the grant stands when the Fix is refused afterwards, and a grant below the limit is refused', async () => {
  const f = fixture();
  const { dash, fix, view } = await withFix(f);
  try {
    const below = await fix(`?scope=checks&updated=${encodeURIComponent((await view())?.updated ?? '')}&grant=true`);
    assert.equal(below.status, 409);
    assert.match(below.text, /limit of 4 is not reached/);
    assert.equal(f.read().extra_loops, undefined);
    atCap(f);
    writeFileSync(join(f.read().worktree ?? '', 'dirty.txt'), 'x\n');
    const refused = await fix(`?scope=checks&updated=${encodeURIComponent((await view())?.updated ?? '')}&grant=true`);
    assert.equal(refused.status, 409);
    assert.match(refused.text, /uncommitted changes/);
    assert.equal(f.read().extra_loops, 1, 'the grant stands');
    assert.equal(f.read().stage, 'finish');
    assert.equal((await view())?.events.filter((e) => e.type === 'extra-loop').length, 1);
  } finally {
    await dash.close();
  }
});

test('no command line option grants a loop', () => {
  const f = fixture();
  const result = run(f.cwd, 'follow-up', '--id', f.id, '--scope', 'checks', '--grant');
  assert.notEqual(result.status, 0);
  assert.equal(f.read().extra_loops, undefined);
});

test('hostile scope, grant and updated query values start nothing', async () => {
  const f = fixture();
  const { dash, fix } = await withFix(f);
  const before = JSON.stringify(f.read());
  try {
    for (const q of [
      `?scope=${encodeURIComponent('checks\nconflicts')}&updated=x`,
      `?scope=${'a'.repeat(5000)}&updated=x`,
      '?scope=CHECKS&updated=x',
      '?scope=__proto__&updated=x',
      '?scope=checks&scope=nothing&updated=x&grant=TRUE',
      '?scope=checks&updated=x&grant=1',
      '?scope=checks&updated=x&grant=true&grant=false&grant=%00',
    ]) {
      const res = await fix(q);
      assert.ok([400, 409].includes(res.status), `${q.slice(0, 40)} answered ${res.status}`);
    }
    assert.equal(JSON.stringify(f.read()), before, 'the Run record is unchanged');
    const control = await fix(`?scope=checks&updated=${encodeURIComponent('\u0000\n'.repeat(5000))}`);
    assert.ok([409, 431].includes(control.status));
    assert.equal(JSON.stringify(f.read()), before);
  } finally {
    await dash.close();
  }
});
