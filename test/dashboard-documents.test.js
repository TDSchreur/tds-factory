import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startDashboard } from '../src/dashboard.js';
import { repo, tempDir } from './git-repo.js';

/** @typedef {Awaited<ReturnType<typeof startDashboard>>} Dash */
/** @type {Dash} */
let dash;
/** @type {Dash} */
let other;
/** @type {string} */
let main;
/** @type {string} */
let wt;
/** @type {string} */
let outside;

const RUN = '2026-02-02-docs';
const ARCHIVED_RUN = '2026-02-03-archived';
const LISTED = [
  'docs/specs/spec.md',
  'docs/specs/only-main.md',
  '.scratch/f/issues/01-a.md',
  '.scratch/f/issues/02-main.md',
  '.scratch/f/issues/03-link.md',
  '.scratch/f/issues/04.txt',
  'a/../../x.md',
  '/etc/passwd.md',
  'dir\\file.md',
  'https://github.com/o/r/issues/1',
  'with%2fslash.md',
];

/** @param {string} root @param {string} rel @param {string} body */
function put(root, rel, body) {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), body);
}

// Raw request so paths are sent exactly as written (fetch normalizes ..).
/**
 * @param {Dash} d
 * @param {string} path
 * @param {string} [method]
 * @returns {Promise<{ status: number, body: string }>}
 */
function request(d, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    http
      .request({ host: '127.0.0.1', port: d.port, path, method }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on('error', reject)
      .end();
  });
}
/** @param {string} path @param {string} [runId] @param {Dash} [d] */
const doc = (path, runId = RUN, d = dash) => request(d, `/documents/${d.projectId}/${runId}/${path}`);

before(async () => {
  main = repo();
  wt = tempDir('docs-worktree-');
  outside = tempDir('docs-outside-');
  put(outside, 'leak.md', 'LEAK');
  const runDir = join(main, '.factory', 'runs', RUN);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'run.json'),
    JSON.stringify({
      title: 'Docs',
      stage: 'build',
      status: 'running',
      worktree: wt,
      spec_link: 'docs/specs/spec.md',
      tickets: LISTED.filter((p) => p !== 'docs/specs/spec.md'),
    }),
  );
  const archivedDir = join(main, '.factory', 'runs', ARCHIVED_RUN);
  mkdirSync(archivedDir, { recursive: true });
  writeFileSync(
    join(archivedDir, 'run.json'),
    JSON.stringify({
      title: 'Done',
      stage: 'finish',
      status: 'done',
      worktree: wt,
      spec_link: 'docs/specs/archived.md',
    }),
  );
  put(wt, 'docs/specs/spec.md', 'WT SPEC');
  put(main, 'docs/specs/spec.md', 'MAIN SPEC');
  put(main, 'docs/specs/only-main.md', 'ONLY MAIN');
  put(main, 'docs/specs/archive/archived.md', 'ARCHIVED');
  put(wt, '.scratch/f/issues/01-a.md', 'TICKET A');
  put(main, '.scratch/f/issues/02-main.md', 'TICKET MAIN');
  put(wt, '.scratch/f/issues/04.txt', 'TEXT');
  put(main, 'unlisted.md', 'UNLISTED');
  put(wt, 'with/slash.md', 'SLASH');
  try {
    symlinkSync(join(outside, 'leak.md'), join(wt, '.scratch/f/issues/03-link.md'));
  } catch {
    // The symlink test skips itself when the platform cannot create one.
  }
  dash = await startDashboard({ projectDir: main, port: 0 });
  other = await startDashboard({ projectDir: repo(), port: 0 });
});

after(async () => {
  await dash.close();
  await other.close();
  for (const dir of [main, wt, outside]) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('a Spec and a Ticket are served from the Run worktree, which wins over the main checkout', async () => {
  const spec = await doc('docs/specs/spec.md');
  assert.equal(spec.status, 200);
  assert.equal(spec.body, 'WT SPEC');
  assert.equal((await doc('.scratch/f/issues/01-a.md')).body, 'TICKET A');
});

test('a document only in the main checkout is served, and a Spec falls back to the archive', async () => {
  assert.equal((await doc('docs/specs/only-main.md')).body, 'ONLY MAIN');
  assert.equal((await doc('.scratch/f/issues/02-main.md')).body, 'TICKET MAIN');
  assert.equal((await doc('docs/specs/archived.md', ARCHIVED_RUN)).body, 'ARCHIVED');
});

test('HEAD answers like GET without a body', async () => {
  const res = await request(dash, `/documents/${dash.projectId}/${RUN}/docs/specs/spec.md`, 'HEAD');
  assert.equal(res.status, 200);
  assert.equal(res.body, '');
});

test('a listed document that exists nowhere is 404', async () => {
  const missing = await doc('.scratch/f/issues/04.txt');
  assert.equal(missing.status, 404);
});

test('POST is not served', async () => {
  assert.equal((await request(dash, `/documents/${dash.projectId}/${RUN}/docs/specs/spec.md`, 'POST')).status, 403);
});

const HOSTILE = [
  ['dot-dot', '../leak.md'],
  ['nested dot-dot', 'a/../../x.md'],
  ['encoded dot-dot', '%2e%2e%2fleak.md'],
  ['absolute path', '/etc/passwd.md'],
  ['absolute path, encoded', '%2Fetc%2Fpasswd.md'],
  ['backslash', 'dir%5Cfile.md'],
  ['raw backslash entry', 'dir\\file.md'],
  ['non-md file', '.scratch/f/issues/04.txt'],
  ['unlisted md', 'unlisted.md'],
  ['listed URL', 'https://github.com/o/r/issues/1'],
  ['encoded slash of a listed path', 'docs%2Fspecs%2Fspec.md'],
  ['encoded slash in an entry', 'with%2fslash.md'],
  ['double-encoded slash', 'with%252fslash.md'],
  ['double-encoded dot-dot', '%252e%252e%252fleak.md'],
  ['NUL byte', 'docs/specs/spec.md%00'],
  ['NUL before extension', 'docs/specs/spec%00.md'],
  ['malformed escape', '%E0%A4%A'],
  ['empty path', ''],
  ['very long path', `${'a/'.repeat(5000)}x.md`],
  ['very deep dot-dot', `${'../'.repeat(2000)}leak.md`],
];
for (const [name, path] of HOSTILE)
  test(`hostile path is 404 without body: ${name}`, async () => {
    const res = await doc(path);
    assert.equal(res.status, 404);
    assert.equal(res.body, 'not found');
  });

test(
  'a symlink that leads outside both folders is refused',
  { skip: process.platform === 'win32' && 'symlinks need privilege on Windows' },
  async () => {
    const res = await doc('.scratch/f/issues/03-link.md');
    assert.equal(res.status, 404);
    assert.equal(res.body, 'not found');
  },
);

test('an unknown Run, an invalid Run id and a Run of another Project are 404', async () => {
  assert.equal((await doc('docs/specs/spec.md', '2026-02-02-nope')).status, 404);
  assert.equal((await doc('docs/specs/spec.md', '..')).status, 404);
  assert.equal((await doc('docs/specs/spec.md', RUN, other)).status, 404);
});

test('the route needs no session token', async () => {
  assert.equal((await doc('docs/specs/spec.md')).status, 200);
});
