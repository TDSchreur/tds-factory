import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboard } from '../src/dashboard.js';
import { openProjectRegistry, projectId } from '../src/project-registry.js';
import { writeHeaders } from './dashboard-token.js';
import './git-repo.js';

/** @import { Run } from '../src/run-record.js' */

const GH = 'https://github.com/o/r/pull/1';
const AZ = 'https://dev.azure.com/o/p/_git/r/pullrequest/1';

/**
 * @param {string} dir
 * @param {string} id
 * @param {Partial<Run>} record
 * @param {Record<string, string>} [files]
 */
function writeRun(dir, id, record, files = {}) {
  const run = join(dir, '.factory', 'runs', id);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'run.json'), JSON.stringify({ stage: 'build', status: 'running', ...record }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(run, name), text);
}

/** @param {string} root @param {string} name @param {string} [parent] */
function folder(root, name, parent = '') {
  const dir = join(root, parent, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {(ctx: { root: string, registry: ReturnType<typeof openProjectRegistry>, start: (options?: object) => ReturnType<typeof startDashboard> }) => Promise<void>} body
 */
async function withRegistry(body) {
  const root = mkdtempSync(join(tmpdir(), 'dash-projects-'));
  const registry = openProjectRegistry({ dir: join(root, 'config') });
  /** @type {Awaited<ReturnType<typeof startDashboard>>[]} */
  const started = [];
  try {
    await body({
      root,
      registry,
      start: async (options = {}) => {
        const dash = await startDashboard({
          projectDir: registry.list()[0]?.path ?? root,
          port: 0,
          registry,
          ...options,
        });
        started.push(dash);
        return dash;
      },
    });
  } finally {
    await Promise.all(started.map((d) => d.close()));
    rmSync(root, { recursive: true, force: true });
  }
}

/** @param {{ url: string }} dash @returns {Promise<any[]>} */
const projectsOf = async (dash) =>
  /** @type {{ projects: any[] }} */ (await (await fetch(`${dash.url}/api/views`)).json()).projects;

test('two Projects with the same Run id stay apart in the views, the Run list and the files', async () => {
  await withRegistry(async ({ root, registry, start }) => {
    const a = folder(root, 'alpha');
    const b = folder(root, 'beta');
    writeRun(a, '2026-01-01-same', { title: 'Alpha run' }, { 'define.md': 'alpha define' });
    writeRun(b, '2026-01-01-same', { title: 'Beta run' }, { 'define.md': 'beta define' });
    const pa = registry.join(a);
    const pb = registry.join(b);
    const dash = await start();
    const projects = await projectsOf(dash);
    assert.deepEqual(
      projects.map((/** @type {any} */ p) => [
        p.id,
        p.name,
        p.missing,
        p.runs.map((/** @type {any} */ r) => [r.id, r.title, r.projectId]),
      ]),
      [
        [pa?.id, 'alpha', false, [['2026-01-01-same', 'Alpha run', pa?.id]]],
        [pb?.id, 'beta', false, [['2026-01-01-same', 'Beta run', pb?.id]]],
      ],
    );
    /** @type {any} */
    const listed = await (await fetch(`${dash.url}/api/projects/${pb?.id}/runs`)).json();
    assert.equal(listed[0].record.title, 'Beta run');
    const file = (/** @type {string | undefined} */ id) =>
      fetch(`${dash.url}/files/${id}/2026-01-01-same/define.md`).then((r) => r.text());
    assert.equal(await file(pa?.id), 'alpha define');
    assert.equal(await file(pb?.id), 'beta define');
  });
});

test('a write reaches only the registered Project it names', async () => {
  await withRegistry(async ({ root, registry, start }) => {
    const a = folder(root, 'alpha');
    const b = folder(root, 'beta');
    const outside = folder(root, 'outside');
    writeRun(a, '2026-01-01-same', { status: 'abandoned' });
    writeRun(b, '2026-01-01-same', { status: 'abandoned' });
    writeRun(outside, '2026-01-01-same', { status: 'abandoned' });
    const pa = registry.join(a);
    const pb = registry.join(b);
    const dash = await start();
    const headers = await writeHeaders(dash);
    const del = (/** @type {string} */ id) =>
      fetch(`${dash.url}/api/projects/${id}/runs/2026-01-01-same`, { method: 'DELETE', headers });
    assert.equal((await del(pa?.id ?? '')).status, 200);
    assert.equal(existsSync(join(a, '.factory', 'runs', '2026-01-01-same')), false);
    assert.equal(existsSync(join(b, '.factory', 'runs', '2026-01-01-same')), true);
    for (const id of [projectId(outside), '..%2F..', encodeURIComponent(outside), 'nope']) {
      assert.equal((await del(id)).status, 404, id);
    }
    assert.equal(existsSync(join(outside, '.factory', 'runs', '2026-01-01-same')), true);
    assert.equal((await fetch(`${dash.url}/api/projects/${pb?.id}/runs`)).status, 200);
  });
});

test('every write on a Project route still needs the Host, the Origin and the token', async () => {
  await withRegistry(async ({ root, registry, start }) => {
    const a = folder(root, 'alpha');
    writeRun(a, 'r', { status: 'abandoned' });
    const pa = registry.join(a);
    const dash = await start();
    const good = await writeHeaders(dash);
    const targets = [
      ['DELETE', `/api/projects/${pa?.id}`],
      ['DELETE', `/api/projects/${pa?.id}/runs/r`],
      ['POST', `/api/projects/${pa?.id}/runs/r/sync`],
    ];
    for (const [method, path] of targets) {
      const url = `${dash.url}${path}`;
      assert.equal((await fetch(url, { method, headers: { ...good, Origin: 'http://evil.example' } })).status, 403);
      assert.equal((await fetch(url, { method, headers: { ...good, 'X-Factory-Token': 'wrong' } })).status, 403);
      assert.equal((await fetch(url, { method, headers: { Origin: good.Origin } })).status, 403);
      assert.equal((await fetch(url, { method })).status, 403);
    }
    assert.equal(registry.list().length, 1);
    assert.equal(existsSync(join(a, '.factory', 'runs', 'r')), true);
  });
});

test('removing a Project takes it out of the registry by id and leaves its folder', async () => {
  await withRegistry(async ({ root, registry, start }) => {
    const a = folder(root, 'alpha');
    const b = folder(root, 'beta');
    writeRun(a, 'r', {});
    const pa = registry.join(a);
    registry.join(b);
    const dash = await start({ projectDir: b });
    const headers = await writeHeaders(dash);
    const remove = (/** @type {string} */ id) => fetch(`${dash.url}/api/projects/${id}`, { method: 'DELETE', headers });
    assert.equal((await remove(encodeURIComponent(a))).status, 404);
    assert.equal((await remove('unknown')).status, 404);
    assert.equal(registry.list().length, 2);
    assert.equal((await remove(pa?.id ?? '')).status, 200);
    assert.deepEqual(
      registry.list().map((p) => p.path),
      [b],
    );
    assert.equal(existsSync(join(a, '.factory', 'runs', 'r')), true);
    assert.deepEqual(
      (await projectsOf(dash)).map((/** @type {any} */ p) => p.name),
      ['beta'],
    );
    assert.equal((await remove(pa?.id ?? '')).status, 404);
    assert.equal((await fetch(`${dash.url}/api/projects/${pa?.id}/runs`)).status, 404);
  });
});

test('a Project whose folder is gone is reported as missing, not dropped', async () => {
  await withRegistry(async ({ root, registry, start }) => {
    const gone = folder(root, 'gone');
    const here = folder(root, 'here');
    writeRun(here, 'r', {});
    const pg = registry.join(gone);
    registry.join(here);
    rmSync(gone, { recursive: true });
    const dash = await start();
    const projects = await projectsOf(dash);
    assert.deepEqual(
      projects.map((/** @type {any} */ p) => [p.name, p.missing, p.runs.length]),
      [
        ['gone', true, 0],
        ['here', false, 1],
      ],
    );
    assert.equal((await fetch(`${dash.url}/api/projects/${pg?.id}/runs`)).status, 409);
    assert.equal(registry.list().length, 2);
  });
});

test('equal Project names get their parent folder; a Project added later appears without a restart', async () => {
  await withRegistry(async ({ root, registry, start }) => {
    registry.join(folder(root, 'app', 'one'));
    const dash = await start();
    assert.deepEqual(
      (await projectsOf(dash)).map((/** @type {any} */ p) => p.name),
      ['app'],
    );
    registry.join(folder(root, 'app', 'two'));
    registry.join(folder(root, 'lib'));
    assert.deepEqual(
      (await projectsOf(dash)).map((/** @type {any} */ p) => p.name),
      ['one/app', 'two/app', 'lib'],
    );
  });
});

test('a Project the server was started for serves alongside the registry before it is registered', async () => {
  await withRegistry(async ({ root, registry, start }) => {
    registry.join(folder(root, 'alpha'));
    const own = folder(root, 'own');
    writeRun(own, 'r', { title: 'Own run' });
    const dash = await start({ projectDir: own });
    const projects = await projectsOf(dash);
    assert.deepEqual(
      projects.map((/** @type {any} */ p) => p.name),
      ['alpha', 'own'],
    );
    assert.equal(projects[1].runs[0].title, 'Own run');
    assert.equal(projects[1].id, dash.projectId);
  });
});

test('removing the unregistered own Project is a 409 with a clear message; unknown ids stay 404', async () => {
  await withRegistry(async ({ root, registry, start }) => {
    registry.join(folder(root, 'alpha'));
    const own = folder(root, 'own');
    const dash = await start({ projectDir: own });
    const headers = await writeHeaders(dash);
    const ownAnswer = await fetch(`${dash.url}/api/projects/${dash.projectId}`, { method: 'DELETE', headers });
    assert.equal(ownAnswer.status, 409);
    const text = await ownAnswer.text();
    assert.match(text, /not in the registry/);
    assert.match(await (await fetch(`${dash.url}/api/views`)).text(), /"name":"own"/);
    assert.equal((await fetch(`${dash.url}/api/projects/unknown`, { method: 'DELETE', headers })).status, 404);
  });
});

test('removing a Project waits asynchronously for the lock and does not block /api/info', async () => {
  await withRegistry(async ({ root, registry, start }) => {
    const a = folder(root, 'alpha');
    registry.join(a);
    const dash = await start();
    const headers = await writeHeaders(dash);
    const lock = join(registry.dir, 'projects.json.lock');
    writeFileSync(lock, 'held');
    let settled = false;
    const removing = fetch(`${dash.url}/api/projects/${projectId(a)}`, { method: 'DELETE', headers }).finally(
      () => (settled = true),
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(settled, false);
    assert.equal((await fetch(`${dash.url}/api/info`)).status, 200);
    rmSync(lock, { force: true });
    assert.equal((await removing).status, 200);
  });
});

test('GitHub and Azure DevOps Projects sit side by side, each with its own PR provider and a lazy status', async () => {
  await withRegistry(async ({ root, registry, start }) => {
    const gh = folder(root, 'gh');
    const az = folder(root, 'az');
    /** @type {Partial<Run>} */
    const finish = { stage: 'finish' };
    writeRun(gh, 'r', { ...finish, pr: GH });
    writeRun(az, 'r', { ...finish, pr: AZ });
    const pg = registry.join(gh);
    const pz = registry.join(az);
    /** @type {string[]} */
    const asked = [];
    const open = {
      state: 'open',
      draft: false,
      checks: { result: 'none', failing: [] },
      merge: 'mergeable',
      review: 'none',
    };
    const dash = await start({
      prFor: (/** @type {{ id: string }} */ project) => ({
        prStatus: async (/** @type {string} */ url) => {
          asked.push(`${project.id} ${url}`);
          return open;
        },
      }),
    });
    const first = await projectsOf(dash);
    assert.deepEqual(
      first.map((/** @type {any} */ p) => [p.runs[0].prHost, p.runs[0].prCanMerge, p.runs[0].prStatus]),
      [
        ['github', true, { checking: true }],
        ['azure-devops', false, { checking: true }],
      ],
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await projectsOf(dash);
    assert.deepEqual(
      second.map((/** @type {any} */ p) => p.runs[0].prStatus),
      [open, open],
    );
    assert.deepEqual(asked.sort(), [`${pz?.id} ${AZ}`, `${pg?.id} ${GH}`].sort());
    const status = await fetch(`${dash.url}/api/projects/${pz?.id}/runs/r/pr-status`);
    assert.deepEqual(await status.json(), open);
  });
});
