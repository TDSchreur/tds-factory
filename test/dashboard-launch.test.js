import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { launchDashboard } from '../src/dashboard-launch.js';
import { openProjectRegistry, projectId } from '../src/project-registry.js';
import { repo, tempDir } from './git-repo.js';

const FACTORY = '2.0.0';

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
  const { launch, warnings } = await setup();
  const old = await launch(repo(), { version: '1.0.0' });
  try {
    const next = await launch(repo());
    assert.equal(next.reused, true);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /1\.0\.0/);
    assert.match(warnings[0], /2\.0\.0/);
    assert.equal((await fetch(`http://127.0.0.1:${old.port}/api/info`)).status, 200);
  } finally {
    await old.close();
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
  const first = await launch(repo(), {
    registry: { ...openProjectRegistry({ dir: tempDir('launch-') }), join: () => undefined },
  });
  try {
    assert.equal(first.reused, false);
    assert.doesNotMatch(first.url, /project=/);
  } finally {
    await first.close();
  }
});
