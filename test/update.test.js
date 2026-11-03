import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import { update, compareVersions } from '../src/update.js';
import { defined } from './run-view.js';

const API = 'https://api.github.com/repos/TDSchreur/tds-factory/releases/latest';
const PAGE = 'https://github.com/TDSchreur/tds-factory/releases/latest';
/** @param {string} tag */
const tgzUrl = (tag) => `https://github.com/TDSchreur/tds-factory/releases/download/${tag}/tds-factory.tgz`;
/** @param {string} tag */
const releaseJson = (tag, { checksum = true } = {}) =>
  Response.json({
    tag_name: tag,
    assets: [
      { name: 'tds-factory.tgz', browser_download_url: tgzUrl(tag) },
      ...(checksum ? [{ name: 'tds-factory.tgz.sha256', browser_download_url: tgzUrl(tag) + '.sha256' }] : []),
    ],
  });
const TGZ = Buffer.alloc(2048, 7);
const HASH = createHash('sha256').update(TGZ).digest('hex');

// A fake world: the GitHub endpoints, npm and the tds-factory binary. `routes` maps a URL to a response or a function
// returning one; `world.calls` records every command that ran, in order.
/** @typedef {Response | Error | ((options: RequestInit) => Response | Error)} Route */
/**
 * @param {object} [config]
 * @param {string} [config.latest]
 * @param {Record<string, Route>} [config.routes]
 * @param {string} [config.installedAfter]
 * @param {number} [config.npmStatus]
 * @param {number} [config.installStatus]
 */
function world({ latest = 'v0.4.0', routes = {}, installedAfter, npmStatus = 0, installStatus = 0 } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'update-test-'));
  /** @type {{ calls: string[], cwds: (string | undefined)[], logs: string[], warns: string[], fetched: string[], sleeps: number[], version: string | undefined }} */
  const state = { calls: [], cwds: [], logs: [], warns: [], fetched: [], sleeps: [], version: undefined };
  /** @type {Record<string, Route>} */
  const defaults = {
    [API]: () => releaseJson(latest),
    [tgzUrl(latest)]: () => new Response(TGZ),
    [tgzUrl(latest) + '.sha256']: () => new Response(`${HASH}  tds-factory.tgz\n`),
  };
  const table = { ...defaults, ...routes };
  /**
   * @param {string | URL | Request} input
   * @param {RequestInit} [options]
   */
  const fetchFn = async (input, options = {}) => {
    const url = String(input);
    state.fetched.push(url);
    const route = table[url];
    if (!route) return new Response('not found', { status: 404 });
    const response = typeof route === 'function' ? route(options) : route;
    if (response instanceof Error) throw response;
    return response;
  };
  /**
   * @param {string} cmd
   * @param {string[]} args
   * @param {{ inherit?: boolean, cwd?: string }} [options]
   */
  const run = (cmd, args, options = {}) => {
    state.calls.push([cmd, ...args].join(' '));
    state.cwds.push(options.cwd);
    if (cmd === 'npm') {
      if (npmStatus === 0) state.version = installedAfter ?? latest.replace(/^v/, '');
      return { status: npmStatus, stdout: '', stderr: '' };
    }
    if (args[0] === '--version') return { status: 0, stdout: `${state.version}\n`, stderr: '' };
    return { status: args[0] === 'install' ? installStatus : 0, stdout: '', stderr: '' };
  };
  return {
    state,
    tmp,
    options: {
      fetchFn,
      run,
      home: '/home-for-test',
      /** @param {number} ms */
      sleep: async (ms) => {
        state.sleeps.push(ms);
      },
      tmpdir: tmp,
      env: {},
      /** @param {string} m */
      log: (m) => void state.logs.push(m),
      /** @param {string} m */
      warn: (m) => void state.warns.push(m),
    },
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

test('an older installed version installs the latest Release, then refreshes the skills with --force', async () => {
  const w = world();
  try {
    await update({ installed: '0.3.0', ...w.options });
    assert.equal(w.state.calls.length, 3, w.state.calls.join('\n'));
    assert.equal(
      w.state.calls[0],
      'npm install -g tds-factory.tgz',
      'a relative name, so a path with spaces never reaches a shell',
    );
    const npmCwd = defined(w.state.cwds[0], 'npm ran in a folder');
    assert.match(npmCwd, /tds-factory-/);
    assert.ok(npmCwd.startsWith(w.tmp), 'npm runs inside the temp download folder');
    assert.equal(w.state.calls[1], 'tds-factory --version');
    assert.equal(w.state.calls[2], 'tds-factory install --force');
    assert.deepEqual(readdirSync(w.tmp), [], 'the temp download is removed');
    assert.match(
      w.state.warns.join('\n'),
      /edited agent files and skills, and same-named skills that tds-factory did not install, are replaced \(use --no-force/,
    );
  } finally {
    w.cleanup();
  }
});

test('--no-force refreshes the skills without --force and does not warn about replacing files', async () => {
  const w = world();
  try {
    await update({ installed: '0.3.0', force: false, ...w.options });
    assert.equal(w.state.calls.at(-1), 'tds-factory install');
    assert.equal(w.state.warns.length, 0);
  } finally {
    w.cleanup();
  }
});

test('already on the latest version skips npm, still refreshes the skills and says which it did', async () => {
  const w = world();
  try {
    await update({ installed: '0.4.0', ...w.options });
    assert.deepEqual(w.state.calls, ['tds-factory install --force']);
    assert.match(w.state.logs.join('\n'), /already on the latest version \(0\.4\.0\)/);
    assert.ok(!w.state.fetched.includes(tgzUrl('v0.4.0')), 'nothing is downloaded');
  } finally {
    w.cleanup();
  }
});

test('a version newer than the latest Release changes nothing and says so', async () => {
  const w = world();
  try {
    await update({ installed: '0.5.0', ...w.options });
    assert.deepEqual(w.state.calls, []);
    assert.match(w.state.logs.join('\n'), /newer than the latest Release \(0\.4\.0\)/);
  } finally {
    w.cleanup();
  }
});

test('when the API fails it falls back to the redirect of /releases/latest', async () => {
  const w = world({
    routes: {
      [API]: () => new Response('rate limited', { status: 403 }),
      [PAGE]: () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://github.com/TDSchreur/tds-factory/releases/tag/v0.4.0' },
        }),
    },
  });
  try {
    await update({ installed: '0.3.0', ...w.options });
    assert.match(w.state.warns.join('\n'), /falling back to the release redirect/);
    assert.match(w.state.calls[0], /^npm install -g /);
    assert.ok(w.state.fetched.includes(tgzUrl('v0.4.0')));
  } finally {
    w.cleanup();
  }
});

test('a transient failure is retried with backoff, then succeeds', async () => {
  let attempts = 0;
  const w = world({
    routes: { [API]: () => (++attempts < 3 ? new Error('connection reset') : releaseJson('v0.4.0')) },
  });
  try {
    await update({ installed: '0.3.0', ...w.options });
    assert.equal(attempts, 3);
    assert.deepEqual(w.state.sleeps, [2000, 4000]);
  } finally {
    w.cleanup();
  }
});

test('a failure that persists rejects with the error and runs no command', async () => {
  const w = world({ routes: { [API]: () => new Error('offline'), [PAGE]: () => new Error('offline') } });
  try {
    await assert.rejects(update({ installed: '0.3.0', ...w.options }), /offline/);
    assert.deepEqual(w.state.calls, []);
  } finally {
    w.cleanup();
  }
});

test('a 5xx or 429 on the redirect lookup is retried, but an API 403 is not', async () => {
  let api = 0;
  let redirect = 0;
  const w = world({
    routes: {
      [API]: () => {
        api++;
        return new Response('rate limited', { status: 403 });
      },
      [PAGE]: () =>
        ++redirect < 3
          ? new Response('busy', { status: redirect === 1 ? 503 : 429 })
          : new Response(null, {
              status: 302,
              headers: { location: 'https://github.com/TDSchreur/tds-factory/releases/tag/v0.4.0' },
            }),
    },
  });
  try {
    await update({ installed: '0.3.0', ...w.options });
    assert.equal(api, 1, 'a 403 is a rate limit, so it falls back at once');
    assert.equal(redirect, 3);
    assert.match(w.state.calls[0], /^npm install -g /);
  } finally {
    w.cleanup();
  }
});

test('a 503 on the checksum is retried; a 403 is not', async () => {
  let hits = 0;
  const sha = tgzUrl('v0.4.0') + '.sha256';
  const w = world({
    routes: {
      [sha]: () => (++hits < 2 ? new Response('busy', { status: 503 }) : new Response(`${HASH}  tds-factory.tgz\n`)),
    },
  });
  try {
    await update({ installed: '0.3.0', ...w.options });
    assert.equal(hits, 2);
    assert.match(w.state.logs.join('\n'), /checksum ok/);
  } finally {
    w.cleanup();
  }
  let forbidden = 0;
  const w2 = world({
    routes: {
      [sha]: () => {
        forbidden++;
        return new Response('no', { status: 403 });
      },
    },
  });
  try {
    await assert.rejects(update({ installed: '0.3.0', ...w2.options }), /checksum download answered 403/);
    assert.equal(forbidden, 1);
    assert.deepEqual(w2.state.calls, []);
  } finally {
    w2.cleanup();
  }
});

test('a 404 for a checksum file the Release lists is an error, not a skipped check', async () => {
  const w = world({ routes: { [tgzUrl('v0.4.0') + '.sha256']: () => new Response('not found', { status: 404 }) } });
  try {
    await assert.rejects(update({ installed: '0.3.0', ...w.options }), /lists a checksum file/);
    assert.deepEqual(w.state.calls, []);
  } finally {
    w.cleanup();
  }
});

test('a download URL that is not a Release asset of this repository is refused', async () => {
  const w = world({
    routes: {
      [API]: () =>
        Response.json({
          tag_name: 'v0.4.0',
          assets: [{ name: 'tds-factory.tgz', browser_download_url: 'https://evil.example/tds-factory.tgz' }],
        }),
      [PAGE]: () => new Response(null, { status: 404 }),
    },
  });
  try {
    await assert.rejects(update({ installed: '0.3.0', ...w.options }), /Could not determine|not a Release asset/);
    assert.ok(!w.state.fetched.includes('https://evil.example/tds-factory.tgz'), 'nothing is downloaded from it');
    assert.deepEqual(w.state.calls, []);
  } finally {
    w.cleanup();
  }
});

test('tds-factory runs in the home folder, never in the current folder', async () => {
  for (const installed of ['0.3.0', '0.4.0']) {
    const w = world();
    try {
      await update({ installed, ...w.options });
      w.state.calls.forEach((call, i) => {
        if (call.startsWith('tds-factory'))
          assert.equal(w.state.cwds[i], '/home-for-test', `${call} runs in the home folder`);
      });
      assert.ok(w.state.calls.some((c) => c === 'tds-factory install --force'));
    } finally {
      w.cleanup();
    }
  }
});

test('a download URL that a parser would resolve into another repository is refused', async () => {
  const sneaky =
    'https://github.com/TDSchreur/tds-factory/releases/download/x/../../../../other/repo/releases/download/v9/tds-factory.tgz';
  const w = world({
    routes: {
      [API]: () =>
        Response.json({ tag_name: 'v0.4.0', assets: [{ name: 'tds-factory.tgz', browser_download_url: sneaky }] }),
      [PAGE]: () => new Response(null, { status: 404 }),
    },
  });
  try {
    await assert.rejects(update({ installed: '0.3.0', ...w.options }), /Could not determine/);
    assert.deepEqual(
      w.state.fetched.filter((u) => u.includes('other/repo')),
      [],
    );
    assert.match(w.state.warns.join('\n'), /not a Release asset of TDSchreur\/tds-factory/);
  } finally {
    w.cleanup();
  }
});

test('a download URL with credentials or another port is refused', async () => {
  for (const url of [
    'https://user:pw@github.com/TDSchreur/tds-factory/releases/download/v0.4.0/tds-factory.tgz',
    'https://github.com:8443/TDSchreur/tds-factory/releases/download/v0.4.0/tds-factory.tgz',
  ]) {
    const w = world({
      routes: {
        [API]: () =>
          Response.json({ tag_name: 'v0.4.0', assets: [{ name: 'tds-factory.tgz', browser_download_url: url }] }),
        [PAGE]: () => new Response(null, { status: 404 }),
      },
    });
    try {
      await assert.rejects(update({ installed: '0.3.0', ...w.options }), /Could not determine/);
      assert.ok(!w.state.fetched.includes(url));
    } finally {
      w.cleanup();
    }
  }
});

test('a tag from the redirect that is not a plain version is refused before any URL is built', async () => {
  for (const tag of ['v0.4.0?x=1', 'v0.4.0%2F..', 'nightly-2026.10.30']) {
    const w = world({
      routes: {
        [API]: () => new Response('limited', { status: 403 }),
        [PAGE]: () =>
          new Response(null, {
            status: 302,
            headers: { location: `https://github.com/TDSchreur/tds-factory/releases/tag/${tag}` },
          }),
      },
    });
    try {
      await assert.rejects(update({ installed: '0.3.0', ...w.options }), /Cannot parse version/, tag);
      assert.deepEqual(w.state.calls, []);
      assert.ok(!w.state.fetched.some((u) => u.includes('/download/')), 'nothing is downloaded');
    } finally {
      w.cleanup();
    }
  }
});

test('the failing update command exits with 1 and prints the error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'update-cli-test-'));
  try {
    const stub = join(dir, 'offline.mjs');
    writeFileSync(
      stub,
      `import { FactoryError } from ${JSON.stringify(pathToFileURL(resolve('src/errors.js')).href)};\n` +
        "globalThis.fetch = async () => { throw new FactoryError('offline', { code: 'http-permanent' }); };\n",
    );
    const result = spawnSync(
      process.execPath,
      ['--import', pathToFileURL(stub).href, resolve('bin/tds-factory.js'), 'update'],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /error: offline/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the GITHUB_TOKEN is sent to the API when set', async () => {
  /** @type {unknown} */
  let auth;
  const w = world({
    routes: {
      [API]: (o) => {
        auth = new Headers(o.headers).get('Authorization');
        return releaseJson('v0.4.0');
      },
    },
  });
  try {
    await update({ installed: '0.4.0', ...w.options, env: { GITHUB_TOKEN: 'abc' } });
    assert.equal(auth, 'Bearer abc');
  } finally {
    w.cleanup();
  }
});

test('a Release without the tarball asset is an error', async () => {
  const w = world({
    routes: {
      [API]: () => Response.json({ tag_name: 'v0.4.0', assets: [] }),
      [PAGE]: () => new Response(null, { status: 302, headers: { location: 'nope' } }),
    },
  });
  try {
    await assert.rejects(update({ installed: '0.3.0', ...w.options }), /no asset|latest release/i);
  } finally {
    w.cleanup();
  }
});

test('a version other than the Release after the npm install fails before the skills step', async () => {
  const w = world({ installedAfter: '0.3.0' });
  try {
    await assert.rejects(update({ installed: '0.3.0', ...w.options }), /expected 0\.4\.0/);
    assert.ok(!w.state.calls.some((c) => c.startsWith('tds-factory install')));
  } finally {
    w.cleanup();
  }
});

test('a failing npm install rejects and skips the skills step', async () => {
  const w = world({ npmStatus: 243 });
  try {
    await assert.rejects(update({ installed: '0.3.0', ...w.options }), /npm install.*exit code 243/);
    assert.ok(!w.state.calls.some((c) => c.startsWith('tds-factory install')));
    assert.deepEqual(readdirSync(w.tmp), [], 'the temp download is removed on failure too');
  } finally {
    w.cleanup();
  }
});

test('a failing skills step rejects', async () => {
  const w = world({ installStatus: 1 });
  try {
    await assert.rejects(update({ installed: '0.4.0', ...w.options }), /tds-factory install.*exit code 1/);
  } finally {
    w.cleanup();
  }
});

test('a matching checksum installs', async () => {
  const w = world({
    routes: { [tgzUrl('v0.4.0') + '.sha256']: () => new Response(`${HASH.toUpperCase()} *tds-factory.tgz\n`) },
  });
  try {
    await update({ installed: '0.3.0', ...w.options });
    assert.match(w.state.calls[0], /^npm install -g /);
    assert.match(w.state.logs.join('\n'), /checksum ok/);
  } finally {
    w.cleanup();
  }
});

test('a checksum mismatch aborts before npm runs and removes the download', async () => {
  const w = world({
    routes: { [tgzUrl('v0.4.0') + '.sha256']: () => new Response(`${'0'.repeat(64)}  tds-factory.tgz\n`) },
  });
  try {
    await assert.rejects(update({ installed: '0.3.0', ...w.options }), /checksum mismatch/);
    assert.deepEqual(w.state.calls, []);
    assert.deepEqual(readdirSync(w.tmp), []);
  } finally {
    w.cleanup();
  }
});

test('a malformed checksum file is an error, not a skipped check', async () => {
  const w = world({ routes: { [tgzUrl('v0.4.0') + '.sha256']: () => new Response('<html>oops</html>') } });
  try {
    await assert.rejects(update({ installed: '0.3.0', ...w.options }), /checksum file/);
    assert.deepEqual(w.state.calls, []);
  } finally {
    w.cleanup();
  }
});

test('a Release without a checksum file warns and still installs', async () => {
  const w = world({
    routes: {
      [API]: () => releaseJson('v0.4.0', { checksum: false }),
      [tgzUrl('v0.4.0') + '.sha256']: () => new Response('not found', { status: 404 }),
    },
  });
  try {
    await update({ installed: '0.3.0', ...w.options });
    assert.match(w.state.warns.join('\n'), /no checksum.*not verified/);
    assert.match(w.state.calls[0], /^npm install -g /);
  } finally {
    w.cleanup();
  }
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

// A server that takes the connection and then says nothing, or stops halfway through the body. fetchFn points every URL at it.
/**
 * @param {(res: http.ServerResponse) => void} behave
 * @returns {Promise<{ fetchFn: typeof fetch, attempts: () => number, close: () => Promise<void> }>}
 */
async function stalledServer(behave) {
  const server = http.createServer((_req, res) => {
    behave(res);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  let attempts = 0;
  return {
    fetchFn: (_url, options) => {
      attempts++;
      return fetch(`http://127.0.0.1:${port}/`, options);
    },
    attempts: () => attempts,
    close: () => {
      server.closeAllConnections();
      return new Promise((done) => server.close(() => done()));
    },
  };
}

test('a server that never answers fails the update within the timeout, after the retries', async () => {
  const server = await stalledServer(() => {});
  const w = world();
  try {
    const started = Date.now();
    await assert.rejects(
      update({ installed: '0.3.0', ...w.options, fetchFn: server.fetchFn, timeoutMs: 50 }),
      (err) =>
        err instanceof Error && 'code' in err && err.code === 'timeout' && /timed out after 0\.05s/.test(err.message),
    );
    assert.ok(Date.now() - started < 5000, 'ends in a bounded time');
    // Counted where the updater calls fetch: under load a 50 ms timeout can abort an attempt before the server sees it.
    assert.equal(server.attempts(), 6, 'three attempts for the API, three for the redirect lookup');
    assert.deepEqual(w.state.calls, [], 'no command ran');
    assert.match(w.state.warns.join('\n'), /GitHub API failed \(attempt 1\/3\): GitHub API timed out after 0\.05s/);
  } finally {
    w.cleanup();
    await server.close();
  }
});

test('a server that stalls halfway through the body also ends the request', async () => {
  const server = await stalledServer((res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"tag_name":');
  });
  const w = world();
  try {
    await assert.rejects(
      update({ installed: '0.3.0', ...w.options, fetchFn: server.fetchFn, timeoutMs: 50 }),
      /timed out after 0\.05s/,
    );
  } finally {
    w.cleanup();
    await server.close();
  }
});

test('a request that times out once is retried and the update goes on', async () => {
  const w = world();
  const inner = w.options.fetchFn;
  let first = true;
  /** @type {typeof fetch} */
  const fetchFn = (input, options) => {
    if (!first) return inner(input, options);
    first = false;
    return new Promise((_resolve, reject) =>
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason)),
    );
  };
  try {
    await update({ installed: '0.3.0', ...w.options, fetchFn, timeoutMs: 50 });
    assert.deepEqual(w.state.sleeps, [2000]);
    assert.match(w.state.calls[0], /^npm install -g /);
  } finally {
    w.cleanup();
  }
});

test('the download may take four times as long as the other requests', async () => {
  const w = world();
  const inner = w.options.fetchFn;
  /** @type {Record<string, number>} */
  const budgets = {};
  /** @type {typeof fetch} */
  const fetchFn = async (input, options) => {
    // The signal is a fresh AbortSignal.timeout; its budget shows in how long it takes to fire.
    const started = Date.now();
    options?.signal?.addEventListener('abort', () => (budgets[String(input)] = Date.now() - started));
    return inner(input, options);
  };
  try {
    await update({ installed: '0.3.0', ...w.options, fetchFn, timeoutMs: 40 });
    await new Promise((done) => setTimeout(done, 250));
    assert.ok((budgets[API] ?? 0) < 100, `API budget ${budgets[API]}`);
    assert.ok((budgets[tgzUrl('v0.4.0')] ?? 0) >= 120, `download budget ${budgets[tgzUrl('v0.4.0')]}`);
  } finally {
    w.cleanup();
  }
});
