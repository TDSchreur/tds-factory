import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
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
  writeFileSync(join(project, 'package.json'), JSON.stringify({ version: '99.88.77' }));
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

test('record with missing or unknown fields is returned as is', async () => {
  const sparse = (await list()).find((r) => r.id === '2026-01-03-sparse');
  assert.equal(sparse.unreadable, false);
  assert.equal(sparse.record.surprise, 1);
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
  assert.match(res.body, /id="app"/);
  assert.doesNotMatch(res.body, /not installed/);
});

test('the stylesheet styles a skipped chip', async () => {
  assert.match((await get(dash, '/style.css')).body, /\.chip\.skipped/);
});

test('info route names the project directory the Dashboard serves', async () => {
  const res = await get(dash, '/api/info');
  assert.equal(res.status, 200);
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  assert.deepEqual(JSON.parse(res.body), { project, version });
  assert.notEqual(version, '99.88.77');
  assert.deepEqual(JSON.parse((await get(emptyDash, '/api/info')).body), { project: empty, version });
});

const getAs = (d, path, host) =>
  new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: d.port, path, headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });

test('a non-GET with a foreign Host is still rejected', async () => {
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: dash.port, path: '/api/runs', method: 'POST', headers: { host: 'evil.example' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
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

test('unsupported methods are rejected', async () => {
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

test('deletion removes completed and active Runs', async () => {
  run('2026-02-01-finished', { 'run.json': JSON.stringify({ status: 'done' }), 'finish.md': 'history' });
  run('active-to-delete', { 'run.json': JSON.stringify({ status: 'running' }) });
  const request = (id) => fetch(`${dash.url}/api/runs/${id}`, { method: 'DELETE', headers: { Origin: dash.url } });
  assert.equal((await request('2026-02-01-finished')).status, 200);
  assert.equal((await request('active-to-delete')).status, 200);
  assert.equal((await get(dash, '/files/2026-02-01-finished/finish.md')).status, 404);
  assert.ok((await list()).some((r) => r.id === '2026-01-01-good'));
});

test('deletion rejects foreign origins and traversal', async () => {
  run('2026-02-02-abandoned', { 'run.json': JSON.stringify({ status: 'abandoned' }) });
  const request = (path, origin = dash.url) => fetch(`${dash.url}${path}`, { method: 'DELETE', headers: { Origin: origin } });
  assert.equal((await request('/api/runs/2026-02-02-abandoned', 'http://evil.example')).status, 403);
  assert.equal((await request('/api/runs/%2e%2e%2fsecret')).status, 400);
  assert.equal((await request('/api/runs/2026-02-02-abandoned')).status, 200);
});

test('terminal Runs with older directory names can be deleted', async () => {
  run('2026-02-03_Ünicode legacy!.run', { 'run.json': JSON.stringify({ status: 'done' }) });
  const response = await fetch(`${dash.url}/api/runs/${encodeURIComponent('2026-02-03_Ünicode legacy!.run')}`, { method: 'DELETE', headers: { Origin: dash.url } });
  assert.equal(response.status, 200);
});

test('deleting a Run with a whitespace-padded ID preserves the similarly named Run', async () => {
  run(' padded ', { 'run.json': JSON.stringify({ status: 'done', title: 'Padded' }) });
  run('padded', { 'run.json': JSON.stringify({ status: 'done', title: 'Unpadded' }) });
  const views = JSON.parse((await get(dash, '/api/views')).body);
  const padded = views.find((r) => r.title === 'Padded');
  assert.equal(padded.id, ' padded ');
  const response = await fetch(`${dash.url}/api/runs/${encodeURIComponent(padded.id)}`, { method: 'DELETE', headers: { Origin: dash.url } });
  assert.equal(response.status, 200);
  assert.ok((await list()).some((r) => r.id === 'padded'));
  assert.ok(!(await list()).some((r) => r.id === ' padded '));
});

test('Dashboard interprets incomplete and unreadable Run records', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'factory-view-'));
  for (const id of ['old', 'broken']) mkdirSync(join(cwd, '.factory', 'runs', id), { recursive: true });
  writeFileSync(join(cwd, '.factory', 'runs', 'old', 'run.json'), JSON.stringify({ stage: 'unknown', status: 'waiting', extra: 1 }));
  writeFileSync(join(cwd, '.factory', 'runs', 'broken', 'run.json'), '{');
  mkdirSync(join(cwd, '.factory', 'runs', 'legacy'), { recursive: true });
  writeFileSync(join(cwd, '.factory', 'runs', 'legacy', 'run.json'), JSON.stringify({ stage: 'prepare', status: 'running' }));
  const dashboard = await startDashboard({ projectDir: cwd, port: 0 });
  try {
    const records = await (await fetch(dashboard.url + '/api/views')).json();
    const old = records.find((r) => r.id === 'old');
    assert.equal(old.column, 'define');
    assert.equal(old.waiting, true);
    assert.equal(records.find((r) => r.id === 'legacy').column, 'define');
    assert.equal(records.find((r) => r.id === 'broken').unreadable, true);
  } finally { await dashboard.close(); }
});

test('the style, scripts and vendored libraries are served at fixed names', async () => {
  for (const [path, type, marker] of [
    ['/style.css', /text\/css/, /--bg:/],
    ['/favicon.svg', /image\/svg\+xml/, /<svg/],
    ['/app.js', /text\/javascript/, /function App/],
    ['/components.js', /text\/javascript/, /export function Card/],
    ['/model.js', /text\/javascript/, /export const COLUMNS/],
    ['/markdown.js', /text\/javascript/, /export function parseMarkdown/],
    ['/vendor/preact.js', /text\/javascript/, /export\{/],
    ['/vendor/hooks.js', /text\/javascript/, /useState/],
    ['/vendor/htm.js', /text\/javascript/, /export default/],
  ]) {
    const res = await get(dash, path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers['content-type'], type, path);
    assert.match(res.body, marker, path);
  }
});

test('the page maps the vendored libraries with an import map', async () => {
  const res = await get(dash, '/');
  assert.match(res.body, /"preact": "\/vendor\/preact\.js"/);
  assert.match(res.body, /<script type="module" src="\/app\.js">/);
});

test('only the allow-listed Dashboard files are served', async () => {
  for (const path of ['/index.html', '/dashboard/app.js', '/package.json', '/src/dashboard.js', '/..%2fpackage.json', '/%2e%2e/package.json', '/style.css/..', '/vendor/LICENSE-preact', '/vendor/README.md', '/vendor/../app.js', '/vendor/%2e%2e/package.json']) {
    const res = await get(dash, path);
    assert.equal(res.status, 404, path);
  }
});

test('a missing Dashboard folder shows the fallback page', async () => {
  const d = await startDashboard({ projectDir: empty, port: 0, dashboardDir: join(tmp, 'no-such-folder') });
  try {
    const res = await get(d, '/');
    assert.equal(res.status, 200);
    assert.match(res.body, /not installed/);
    assert.equal((await get(d, '/app.js')).status, 404);
  } finally { await d.close(); }
});

test('the page links the SVG favicon and a plain title', async () => {
  const res = await get(dash, '/');
  assert.match(res.body, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/);
  assert.match(res.body, /<title>TDS Factory<\/title>/);
});

test('project review outcomes, findings and skip reasons are visible in the Dashboard view', async () => {
  run('2026-01-05-project-reviews', { 'run.json': JSON.stringify({ title: 'Reviews', stage: 'check', status: 'running', project_reviews: [{ id: 'angular', name: 'Angular' }, { id: 'ux', name: 'UX' }], project_results: { angular: { verdict: 'fail', findings: [{ severity: 'MEDIUM', description: 'Bad label', location: 'src/app.html' }] }, ux: { verdict: 'skipped', reason: 'No changed file matches the review patterns' } } }) });
  const views = JSON.parse((await get(dash, '/api/views')).body);
  const view = views.find(v => v.id === '2026-01-05-project-reviews');
  assert.deepEqual(view.projectReviews.map(r => [r.name, r.verdict]), [['Angular', 'fail'], ['UX', 'skipped']]);
  assert.equal(view.projectReviews[0].findings[0].description, 'Bad label');
  assert.match(view.projectReviews[1].reason, /No changed file/);
});

test('numbered Follow-up summaries follow Finish and are sorted by observation', async () => {
  run('2026-01-05-follow-up', { 'run.json': JSON.stringify({ stage: 'follow-up', status: 'running' }), 'follow-up-10.md': '10', 'follow-up-2.md': '2', 'finish.md': 'finish' });
  assert.deepEqual((await list()).find((r) => r.id === '2026-01-05-follow-up').files, ['finish.md', 'follow-up-2.md', 'follow-up-10.md']);
});
