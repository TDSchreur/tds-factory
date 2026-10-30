import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { update, compareVersions } from '../src/update.js';

const API = 'https://api.github.com/repos/TDSchreur/tds-factory/releases/latest';
const PAGE = 'https://github.com/TDSchreur/tds-factory/releases/latest';
const tgzUrl = (tag) => `https://github.com/TDSchreur/tds-factory/releases/download/${tag}/tds-factory.tgz`;
const TGZ = Buffer.alloc(2048, 7);
const HASH = createHash('sha256').update(TGZ).digest('hex');

// A fake world: the GitHub endpoints, npm and the tds-factory binary. `routes` maps a URL to a response or a function
// returning one; `world.calls` records every command that ran, in order.
function world({ latest = 'v0.4.0', routes = {}, installedAfter, npmStatus = 0, installStatus = 0 } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'update-test-'));
  const state = { calls: [], logs: [], warns: [], fetched: [], sleeps: [], version: undefined };
  const defaults = {
    [API]: () => Response.json({ tag_name: latest, assets: [{ name: 'tds-factory.tgz', browser_download_url: tgzUrl(latest) }] }),
    [tgzUrl(latest)]: () => new Response(TGZ),
    [tgzUrl(latest) + '.sha256']: () => new Response(`${HASH}  tds-factory.tgz\n`),
  };
  const table = { ...defaults, ...routes };
  const fetchFn = async (url, options = {}) => {
    state.fetched.push(url);
    const route = table[url];
    if (!route) return new Response('not found', { status: 404 });
    const response = typeof route === 'function' ? route(options) : route;
    if (response instanceof Error) throw response;
    return response;
  };
  const run = (cmd, args) => {
    state.calls.push([cmd, ...args].join(' '));
    if (cmd === 'npm') {
      if (npmStatus === 0) state.version = installedAfter ?? latest.replace(/^v/, '');
      return { status: npmStatus, stdout: '', stderr: '' };
    }
    if (args[0] === '--version') return { status: 0, stdout: `${state.version}\n`, stderr: '' };
    return { status: args[0] === 'install' ? installStatus : 0, stdout: '', stderr: '' };
  };
  return {
    state, tmp,
    options: { fetchFn, run, sleep: async (ms) => { state.sleeps.push(ms); }, tmpdir: tmp, env: {}, log: (m) => state.logs.push(m), warn: (m) => state.warns.push(m) },
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

test('an older installed version installs the latest Release, then refreshes the skills with --force', async () => {
  const w = world();
  try {
    await update({ installed: '0.3.0', ...w.options });
    assert.equal(w.state.calls.length, 3, w.state.calls.join('\n'));
    assert.match(w.state.calls[0], /^npm install -g .*tds-factory\.tgz$/);
    assert.equal(w.state.calls[1], 'tds-factory --version');
    assert.equal(w.state.calls[2], 'tds-factory install --force');
    assert.deepEqual(readdirSync(w.tmp), [], 'the temp download is removed');
    assert.match(w.state.warns.join('\n'), /edited agent files are replaced with the defaults/);
  } finally { w.cleanup(); }
});

test('--no-force refreshes the skills without --force and does not warn about replacing files', async () => {
  const w = world();
  try {
    await update({ installed: '0.3.0', force: false, ...w.options });
    assert.equal(w.state.calls.at(-1), 'tds-factory install');
    assert.equal(w.state.warns.length, 0);
  } finally { w.cleanup(); }
});

test('already on the latest version skips npm, still refreshes the skills and says which it did', async () => {
  const w = world();
  try {
    await update({ installed: '0.4.0', ...w.options });
    assert.deepEqual(w.state.calls, ['tds-factory install --force']);
    assert.match(w.state.logs.join('\n'), /already on the latest version \(0\.4\.0\)/);
    assert.ok(!w.state.fetched.includes(tgzUrl('v0.4.0')), 'nothing is downloaded');
  } finally { w.cleanup(); }
});

test('a version newer than the latest Release changes nothing and says so', async () => {
  const w = world();
  try {
    await update({ installed: '0.5.0', ...w.options });
    assert.deepEqual(w.state.calls, []);
    assert.match(w.state.logs.join('\n'), /newer than the latest Release \(0\.4\.0\)/);
  } finally { w.cleanup(); }
});

test('when the API fails it falls back to the redirect of /releases/latest', async () => {
  const w = world({
    routes: {
      [API]: () => new Response('rate limited', { status: 403 }),
      [PAGE]: () => new Response(null, { status: 302, headers: { location: 'https://github.com/TDSchreur/tds-factory/releases/tag/v0.4.0' } }),
    },
  });
  try {
    await update({ installed: '0.3.0', ...w.options });
    assert.match(w.state.warns.join('\n'), /falling back to the release redirect/);
    assert.match(w.state.calls[0], /^npm install -g /);
    assert.ok(w.state.fetched.includes(tgzUrl('v0.4.0')));
  } finally { w.cleanup(); }
});

test('a transient failure is retried with backoff, then succeeds', async () => {
  let attempts = 0;
  const w = world({
    routes: { [API]: () => (++attempts < 3 ? new Error('connection reset') : Response.json({ tag_name: 'v0.4.0', assets: [{ name: 'tds-factory.tgz', browser_download_url: tgzUrl('v0.4.0') }] })) },
  });
  try {
    await update({ installed: '0.3.0', ...w.options });
    assert.equal(attempts, 3);
    assert.deepEqual(w.state.sleeps, [2000, 4000]);
  } finally { w.cleanup(); }
});

test('a permanent failure rejects with the error and runs no command', async () => {
  const w = world({ routes: { [API]: () => new Error('offline'), [PAGE]: () => new Error('offline') } });
  try {
    await assert.rejects(update({ installed: '0.3.0', ...w.options }), /offline/);
    assert.deepEqual(w.state.calls, []);
  } finally { w.cleanup(); }
});

test('the GITHUB_TOKEN is sent to the API when set', async () => {
  let auth;
  const w = world({ routes: { [API]: (o) => { auth = o.headers?.Authorization; return Response.json({ tag_name: 'v0.4.0', assets: [{ name: 'tds-factory.tgz', browser_download_url: tgzUrl('v0.4.0') }] }); } } });
  try {
    await update({ installed: '0.4.0', ...w.options, env: { GITHUB_TOKEN: 'abc' } });
    assert.equal(auth, 'Bearer abc');
  } finally { w.cleanup(); }
});

test('a Release without the tarball asset is an error', async () => {
  const w = world({ routes: { [API]: () => Response.json({ tag_name: 'v0.4.0', assets: [] }), [PAGE]: () => new Response(null, { status: 302, headers: { location: 'nope' } }) } });
  try {
    await assert.rejects(update({ installed: '0.3.0', ...w.options }), /no asset|latest release/i);
  } finally { w.cleanup(); }
});

test('a version other than the Release after the npm install fails before the skills step', async () => {
  const w = world({ installedAfter: '0.3.0' });
  try {
    await assert.rejects(update({ installed: '0.3.0', ...w.options }), /expected 0\.4\.0/);
    assert.ok(!w.state.calls.some((c) => c.startsWith('tds-factory install')));
  } finally { w.cleanup(); }
});

test('a failing npm install rejects and skips the skills step', async () => {
  const w = world({ npmStatus: 243 });
  try {
    await assert.rejects(update({ installed: '0.3.0', ...w.options }), /npm install.*exit code 243/);
    assert.ok(!w.state.calls.some((c) => c.startsWith('tds-factory install')));
    assert.deepEqual(readdirSync(w.tmp), [], 'the temp download is removed on failure too');
  } finally { w.cleanup(); }
});

test('a failing skills step rejects', async () => {
  const w = world({ installStatus: 1 });
  try {
    await assert.rejects(update({ installed: '0.4.0', ...w.options }), /tds-factory install.*exit code 1/);
  } finally { w.cleanup(); }
});

test('a matching checksum installs', async () => {
  const w = world({ routes: { [tgzUrl('v0.4.0') + '.sha256']: () => new Response(`${HASH.toUpperCase()} *tds-factory.tgz\n`) } });
  try {
    await update({ installed: '0.3.0', ...w.options });
    assert.match(w.state.calls[0], /^npm install -g /);
    assert.match(w.state.logs.join('\n'), /checksum ok/);
  } finally { w.cleanup(); }
});

test('a checksum mismatch aborts before npm runs and removes the download', async () => {
  const w = world({ routes: { [tgzUrl('v0.4.0') + '.sha256']: () => new Response(`${'0'.repeat(64)}  tds-factory.tgz\n`) } });
  try {
    await assert.rejects(update({ installed: '0.3.0', ...w.options }), /checksum mismatch/);
    assert.deepEqual(w.state.calls, []);
    assert.deepEqual(readdirSync(w.tmp), []);
  } finally { w.cleanup(); }
});

test('a malformed checksum file is an error, not a skipped check', async () => {
  const w = world({ routes: { [tgzUrl('v0.4.0') + '.sha256']: () => new Response('<html>oops</html>') } });
  try {
    await assert.rejects(update({ installed: '0.3.0', ...w.options }), /checksum file/);
    assert.deepEqual(w.state.calls, []);
  } finally { w.cleanup(); }
});

test('a Release without a checksum file warns and still installs', async () => {
  const w = world({ routes: { [tgzUrl('v0.4.0') + '.sha256']: () => new Response('not found', { status: 404 }) } });
  try {
    await update({ installed: '0.3.0', ...w.options });
    assert.match(w.state.warns.join('\n'), /no checksum.*not verified/);
    assert.match(w.state.calls[0], /^npm install -g /);
  } finally { w.cleanup(); }
});

test('the release workflow writes the checksum and attaches it with the tarball', () => {
  const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /sha256sum tds-factory\.tgz > tds-factory\.tgz\.sha256/);
  assert.match(workflow, /gh release create .*tds-factory\.tgz tds-factory\.tgz\.sha256/);
});

test('versions compare as semver and a prerelease sorts below its release', () => {
  assert.ok(compareVersions('0.3.0', '0.4.0') < 0);
  assert.ok(compareVersions('0.10.0', '0.9.0') > 0);
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
  assert.ok(compareVersions('1.0.0-rc.1', '1.0.0') < 0);
  assert.ok(compareVersions('1.0.0-rc.2', '1.0.0-rc.10') < 0);
  assert.throws(() => compareVersions('nope', '1.0.0'), /Cannot parse version/);
});

test('the usage text lists update and the CLI dispatches it', () => {
  const result = spawnSync(process.execPath, [resolve('bin/tds-factory.js')], { encoding: 'utf8' });
  assert.match(result.stdout, /tds-factory update \[--no-force\]/);
  assert.match(readFileSync(resolve('bin/tds-factory.js'), 'utf8'), /command === 'update'/);
});
