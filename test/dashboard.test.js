import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboard } from '../src/dashboard.js';

let tmp, project, empty, dash, emptyDash;

function run(id, files) {
  const dir = join(project, '.factory', 'runs', id);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
}

// Raw request so paths are sent exactly as written (fetch normalizes ..).
function get(d, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: d.port, path }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'dash-'));
  project = join(tmp, 'project');
  empty = join(tmp, 'empty');
  mkdirSync(empty);
  run('2026-01-01-good', {
    'run.json': JSON.stringify({ title: 'Good run', stage: 'build', status: 'running' }),
    'define.md': '# Define summary\n',
  });
  run('2026-01-02-broken', { 'run.json': '{"title": "half writt' });
  run('2026-01-03-sparse', { 'run.json': JSON.stringify({ surprise: 1 }) });
  run('2026-01-04-norecord', { 'define.md': 'x' });
  writeFileSync(join(tmp, 'secret.md'), 'SECRET');
  writeFileSync(join(project, '.factory', 'secret.md'), 'NOT-A-RUN-FILE');
  dash = await startDashboard({ projectDir: project, port: 0 });
  emptyDash = await startDashboard({ projectDir: empty, port: 0 });
});

after(async () => {
  await dash.close();
  await emptyDash.close();
  rmSync(tmp, { recursive: true, force: true });
});

const list = async (d = dash) => JSON.parse((await get(d, '/api/runs')).body);

test('list returns valid Run records with their id', async () => {
  const good = (await list()).find((r) => r.id === '2026-01-01-good');
  assert.equal(good.record.title, 'Good run');
  assert.equal(good.record.stage, 'build');
  assert.equal(good.unreadable, false);
});

test('malformed record is flagged and does not break the list', async () => {
  const runs = await list();
  const broken = runs.find((r) => r.id === '2026-01-02-broken');
  assert.equal(broken.unreadable, true);
  assert.ok(runs.find((r) => r.id === '2026-01-01-good'));
});

test('record with missing or unknown fields is returned as is', async () => {
  const sparse = (await list()).find((r) => r.id === '2026-01-03-sparse');
  assert.equal(sparse.unreadable, false);
  assert.equal(sparse.record.surprise, 1);
});

test('run folder without a record is flagged', async () => {
  const r = (await list()).find((r) => r.id === '2026-01-04-norecord');
  assert.equal(r.unreadable, true);
});

test('missing .factory/ gives an empty list', async () => {
  const res = await get(emptyDash, '/api/runs');
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), []);
});

test('file route returns a Markdown file of a Run', async () => {
  const res = await get(dash, '/files/2026-01-01-good/define.md');
  assert.equal(res.status, 200);
  assert.equal(res.body, '# Define summary\n');
});

test('list names the Markdown files of each Run, sorted, without run.json', async () => {
  const runs = await list();
  assert.deepEqual(runs.find((r) => r.id === '2026-01-01-good').files, ['define.md']);
  assert.deepEqual(runs.find((r) => r.id === '2026-01-03-sparse').files, []);
  assert.deepEqual(runs.find((r) => r.id === '2026-01-02-broken').files, []);
});

test('list orders Stage summaries by Stage, check passes numerically', async () => {
  run('2026-01-05-ordered', {
    'run.json': JSON.stringify({ title: 'Ordered' }),
    'finish.md': 'f', 'check-10.md': 'c', 'check-2.md': 'c', 'build.md': 'b', 'check-1.md': 'c', 'define.md': 'd',
  });
  const r = (await list()).find((r) => r.id === '2026-01-05-ordered');
  assert.deepEqual(r.files, ['define.md', 'build.md', 'check-1.md', 'check-2.md', 'check-10.md', 'finish.md']);
});

test('file route rejects traversal and anything outside a Run', async () => {
  const bad = [
    '/files/2026-01-01-good/../../../secret.md',
    '/files/..%2F..%2F..%2Fsecret.md',
    '/files/2026-01-01-good/..%2F..%2F..%2Fsecret.md',
    '/files/2026-01-01-good/%2e%2e%2f%2e%2e%2f%2e%2e%2fsecret.md',
    '/files/2026-01-01-good/%2Fetc%2Fpasswd',
    '/files//etc/passwd',
    '/files/2026-01-01-good/..%5C..%5Csecret.md',
    '/files/2026-01-01-good/define.md%00.txt',
    '/files/../../secret.md',
    '/files/2026-01-01-good/run.json',
    '/files/2026-01-01-good/nope.md',
    '/files/%E0%A4%A',
  ];
  for (const p of bad) {
    const res = await get(dash, p);
    assert.ok([400, 403, 404].includes(res.status), `${p} -> ${res.status}`);
    assert.ok(!res.body.includes('SECRET') && !res.body.includes('NOT-A-RUN-FILE'), p);
  }
});

test('page route serves HTML', async () => {
  const res = await get(dash, '/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
});

test('page route serves the real board page', async () => {
  const res = await get(dash, '/');
  assert.match(res.body, /id="board"/);
  assert.doesNotMatch(res.body, /not installed/);
});

test('info route names the project directory the Dashboard serves', async () => {
  const res = await get(dash, '/api/info');
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { project });
});

const getAs = (d, path, host) =>
  new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: d.port, path, headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });

test('a foreign Host header gets 403 on every route; loopback names still work', async () => {
  const routes = ['/', '/api/runs', '/api/info', '/files/2026-01-01-good/define.md'];
  for (const path of routes) {
    assert.equal(await getAs(dash, path, 'evil.example'), 403, path);
    assert.equal(await getAs(dash, path, `evil.example:${dash.port}`), 403, path);
    assert.equal(await getAs(dash, path, `localhost:${dash.port}`), 200, path);
    assert.equal(await getAs(dash, path, `127.0.0.1:${dash.port}`), 200, path);
  }
});

test('server listens on loopback only', () => {
  assert.equal(dash.server.address().address, '127.0.0.1');
  assert.match(dash.url, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test('is read-only: non-GET methods are rejected', async () => {
  for (const path of ['/api/runs', '/api/info']) {
    const status = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: dash.port, path, method: 'POST' }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.end();
    });
    assert.equal(status, 405, path);
  }
});
