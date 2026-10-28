import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startDashboard } from '../src/dashboard.js';
import { repo, linked } from './git-repo.js';

const answers = async (d) => (await fetch(`${d.url}/api/info`)).status === 200;

test('the same repo gets the same port each time', async () => {
  const main = repo();
  const first = await startDashboard({ projectDir: main });
  const port = first.port;
  await first.close();
  const second = await startDashboard({ projectDir: main });
  try {
    assert.equal(second.port, port);
    assert.ok(port >= 4300 && port <= 4999);
  } finally {
    await second.close();
  }
});

test('a subfolder and a linked worktree get the port of the main checkout', async () => {
  const main = repo();
  const sub = join(main, 'sub');
  mkdirSync(sub);
  const a = await startDashboard({ projectDir: main });
  const port = a.port;
  await a.close();
  for (const dir of [sub, linked(main)]) {
    const d = await startDashboard({ projectDir: dir });
    try {
      assert.equal(d.port, port);
    } finally {
      await d.close();
    }
  }
});

test('different repos get different ports', async () => {
  const ports = [];
  const open = [];
  try {
    for (let i = 0; i < 5; i++) {
      const d = await startDashboard({ projectDir: repo() });
      open.push(d);
      ports.push(d.port);
    }
    assert.ok(new Set(ports).size > 1);
  } finally {
    await Promise.all(open.map((d) => d.close()));
  }
});

test('a busy default port falls back to a free port and still answers', async () => {
  const main = repo();
  const first = await startDashboard({ projectDir: main });
  const second = await startDashboard({ projectDir: main });
  try {
    assert.notEqual(second.port, first.port);
    assert.ok(await answers(second));
  } finally {
    await first.close();
    await second.close();
  }
});

test('an explicit busy port is an error and port 0 gives a free port', async () => {
  const blocker = net.createServer();
  await new Promise((ok) => blocker.listen(0, '127.0.0.1', ok));
  const { port } = blocker.address();
  try {
    await assert.rejects(startDashboard({ projectDir: repo(), port }), { code: 'EADDRINUSE' });
    const d = await startDashboard({ projectDir: repo(), port: 0 });
    assert.ok(d.port > 0 && d.port !== port);
    await d.close();
  } finally {
    blocker.close();
  }
});
