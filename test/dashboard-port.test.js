import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startDashboard } from '../src/dashboard.js';
import { repo } from './git-repo.js';
import { portOf } from './browser.js';

/** @param {{ url: string }} d */
const answers = async (d) => (await fetch(`${d.url}/api/info`)).status === 200;

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
  await new Promise((ok) => blocker.listen(0, '127.0.0.1', () => ok(undefined)));
  const port = portOf(blocker);
  try {
    await assert.rejects(startDashboard({ projectDir: repo(), port }), { code: 'EADDRINUSE' });
    const d = await startDashboard({ projectDir: repo(), port: 0 });
    try {
      assert.ok(d.port > 0 && d.port !== port);
    } finally {
      await d.close();
    }
  } finally {
    await new Promise((ok) => blocker.close(() => ok(undefined)));
  }
});
