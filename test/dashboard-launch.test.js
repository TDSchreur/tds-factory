import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { startDashboard } from '../src/dashboard.js';
import { launchDashboard } from '../src/dashboard-launch.js';
import { openProjectRegistry, projectId } from '../src/project-registry.js';
import { mainCheckout } from '../src/run-folder.js';
import { repo, tempDir } from './git-repo.js';

const FACTORY = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

async function freePort() {
  const probe = net.createServer();
  await new Promise((ok) => probe.listen(0, '127.0.0.1', () => ok(undefined)));
  const address = probe.address();
  await new Promise((ok) => probe.close(() => ok(undefined)));
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

async function setup() {
  /** @type {string[]} */
  const warnings = [];
  const registry = openProjectRegistry({ dir: tempDir('launch-'), warn: (m) => warnings.push(m) });
  const preferredPort = await freePort();
  /** @param {string} projectDir @param {Record<string, unknown>} [extra] */
  const launch = (projectDir, extra = {}) =>
    launchDashboard({ projectDir, registry, version: FACTORY, preferredPort, warn: (m) => warnings.push(m), ...extra });
  return { registry, warnings, preferredPort, launch };
}

test('the first call serves on the preferred port, registers its Project and writes the state file', async () => {
  const { registry, launch, preferredPort } = await setup();
  const main = repo();
  const first = await launch(main);
  try {
    assert.equal(first.reused, false);
    assert.equal(first.url, `http://127.0.0.1:${preferredPort}/?project=${projectId(main)}`);
    assert.deepEqual(registry.readState(), { pid: process.pid, port: preferredPort, version: FACTORY });
    assert.deepEqual(
      registry.list().map((p) => p.path),
      [main],
    );
  } finally {
    await first.close();
  }
  assert.equal(registry.readState(), undefined);
});

test('a later call from another repository registers it, prints its URL and starts no server', async () => {
  const { registry, launch, preferredPort, warnings } = await setup();
  const a = repo();
  const b = repo();
  const first = await launch(a);
  try {
    const second = await launch(b);
    assert.equal(second.reused, true);
    assert.equal(second.url, `http://127.0.0.1:${preferredPort}/?project=${projectId(b)}`);
    assert.deepEqual(
      registry.list().map((p) => p.path),
      [a, b],
    );
    assert.deepEqual(warnings, []);
  } finally {
    await first.close();
  }
});

test('a stale state file is ignored and replaced', async () => {
  const { registry, launch } = await setup();
  const dead = await freePort();
  registry.writeState({ pid: 999999, port: dead, version: FACTORY });
  const first = await launch(repo());
  try {
    assert.equal(first.reused, false);
    assert.equal(registry.readState()?.pid, process.pid);
    assert.equal(registry.readState()?.port, first.port);
  } finally {
    await first.close();
  }
});

test('a state file that names another pid is not trusted even when something answers', async () => {
  const { registry, launch } = await setup();
  const running = await launch(repo());
  try {
    registry.writeState({ pid: process.pid + 1, port: running.port, version: FACTORY });
    const next = await launch(repo(), { preferredPort: 0 });
    try {
      assert.equal(next.reused, false);
      assert.notEqual(next.port, running.port);
    } finally {
      await next.close();
    }
  } finally {
    await running.close();
  }
});

test('a start that loses the race to the preferred port reuses the winner', async () => {
  const { registry, launch, preferredPort } = await setup();
  const winner = await launch(repo());
  registry.clearState(process.pid);
  try {
    const loser = await launch(repo());
    assert.equal(loser.reused, true);
    assert.equal(loser.port, preferredPort);
  } finally {
    await winner.close();
  }
});

test('a busy preferred port that is not a Dashboard falls back to a free port', async () => {
  const { launch, preferredPort } = await setup();
  const blocker = net.createServer((socket) => socket.destroy());
  await new Promise((ok) => blocker.listen(preferredPort, '127.0.0.1', () => ok(undefined)));
  try {
    const first = await launch(repo());
    try {
      assert.equal(first.reused, false);
      assert.notEqual(first.port, preferredPort);
    } finally {
      await first.close();
    }
  } finally {
    await new Promise((ok) => blocker.close(() => ok(undefined)));
  }
});

test('a running Dashboard of an older Factory version is reported and left running', async () => {
  /** @type {string[]} */
  const warnings = [];
  const server = http.createServer((req, res) => {
    if (req.url !== '/api/info') return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ token: 't', project: '/tmp/p', shared: true, pid: 123, version: '0.0.1' }));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(undefined)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  try {
    const next = await launchDashboard({
      projectDir: repo(),
      version: FACTORY,
      warn: (m) => warnings.push(m),
      registry: {
        dir: tempDir('launch-'),
        join: (projectPath) => ({ id: projectId(projectPath), path: projectPath }),
        list: () => [],
        remove: () => false,
        removeAsync: async () => false,
        removeMissingAsync: async () => [],
        readState: () => ({ pid: 123, port, version: '0.0.1' }),
        writeState: () => {},
        clearState: () => {},
      },
    });
    assert.equal(next.reused, true);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /0\.0\.1/);
    assert.match(warnings[0], new RegExp(FACTORY.replace(/\./g, '\\.')));
  } finally {
    await new Promise((ok) => server.close(() => ok(undefined)));
  }
});

test('an explicit port starts a standalone server that neither reads nor writes the state file', async () => {
  const { registry, launch, preferredPort } = await setup();
  const running = await launch(repo());
  try {
    const before = registry.readState();
    const standalone = await launch(repo(), { port: 0 });
    try {
      assert.equal(standalone.reused, false);
      assert.notEqual(standalone.port, preferredPort);
      assert.doesNotMatch(standalone.url, /project=/);
      assert.deepEqual(registry.readState(), before);
    } finally {
      await standalone.close();
    }
    assert.deepEqual(registry.readState(), before);
  } finally {
    await running.close();
  }
});

test('a registry that cannot be written does not stop the Dashboard', async () => {
  const { launch } = await setup();
  const main = repo();
  const first = await launch(main, {
    registry: { ...openProjectRegistry({ dir: tempDir('launch-') }), join: () => undefined },
  });
  try {
    assert.equal(first.reused, false);
    assert.equal(first.url, `http://127.0.0.1:${first.port}/?project=${projectId(mainCheckout(main).dir)}`);
  } finally {
    await first.close();
  }
});

test('a non-semver dashboard version from state or /api/info is treated as unknown', async () => {
  /** @type {string[]} */
  const warnings = [];
  const project = mainCheckout(repo()).dir;
  const server = http.createServer((req, res) => {
    if (req.url !== '/api/info') return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ token: 't', project, shared: true, pid: 456, version: '1.0.0\n\x1b[31mforged' }));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(undefined)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  try {
    const launched = await launchDashboard({
      projectDir: project,
      version: FACTORY,
      preferredPort: 0,
      warn: (m) => warnings.push(m),
      registry: {
        dir: tempDir('launch-'),
        join: () => ({ id: projectId(project), path: project }),
        list: () => [],
        remove: () => false,
        removeAsync: async () => false,
        removeMissingAsync: async () => [],
        readState: () => ({ pid: 456, port, version: '1.0.0\n\x1b[31mforged' }),
        writeState: () => {},
        clearState: () => {},
      },
    });
    try {
      assert.equal(launched.reused, true);
    } finally {
      await launched.close();
    }
    assert.equal(warnings.length, 0);
  } finally {
    await new Promise((ok) => server.close(() => ok(undefined)));
  }
});

test('a standalone Dashboard on the preferred port is a busy port, not a Dashboard to reuse', async () => {
  const { registry, launch, preferredPort } = await setup();
  const standalone = await startDashboard({ projectDir: repo(), port: preferredPort });
  try {
    const main = repo();
    const second = await launch(main);
    try {
      assert.equal(second.reused, false);
      assert.notEqual(second.port, preferredPort);
      assert.deepEqual(
        registry.list().map((p) => p.path),
        [main],
      );
      const info = /** @type {{ shared?: boolean }} */ (
        await (await fetch(`http://127.0.0.1:${second.port}/api/info`)).json()
      );
      assert.equal(info.shared, true);
    } finally {
      await second.close();
    }
  } finally {
    await standalone.close();
  }
});
