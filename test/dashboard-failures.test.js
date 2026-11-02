import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboard } from '../src/dashboard.js';

/**
 * @param {number} port
 * @param {string} path
 * @returns {Promise<{ status: number, body: string }>}
 */
const get = (port, path) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on('error', reject);
  });

const canBreakReads = process.platform !== 'win32' && process.getuid?.() !== 0;

test(
  'a handler that throws answers internal error and logs the cause to stderr without the query string',
  { skip: !canBreakReads && 'file permissions cannot make a read fail here' },
  async () => {
    const project = mkdtempSync(join(tmpdir(), 'dash-fail-'));
    const dir = join(project, '.factory', 'runs', '2026-01-01-good');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ title: 'Good', stage: 'build', status: 'running' }));
    const file = join(dir, 'define.md');
    writeFileSync(file, '# Define\n');
    chmodSync(file, 0o000);
    const logged = mock.method(console, 'error', () => {});
    const dash = await startDashboard({ projectDir: project, port: 0 });
    try {
      const answer = await get(dash.port, '/files/2026-01-01-good/define.md?token=secret');
      assert.equal(answer.status, 500);
      assert.equal(answer.body, 'internal error');
      assert.equal(logged.mock.callCount(), 1);
      const line = String(logged.mock.calls[0].arguments[0]);
      assert.match(line, /^dashboard: GET \/files\/2026-01-01-good\/define\.md: .*EACCES/s);
      assert.doesNotMatch(line, /secret/);
      assert.doesNotMatch(line.split(':')[1], /[\x00-\x1f]/);
    } finally {
      logged.mock.restore();
      await dash.close();
      chmodSync(file, 0o644);
      rmSync(project, { recursive: true, force: true });
    }
  },
);

test('a file that is not there is a 404 and logs nothing', async () => {
  const project = mkdtempSync(join(tmpdir(), 'dash-fail-'));
  const logged = mock.method(console, 'error', () => {});
  const dash = await startDashboard({ projectDir: project, port: 0 });
  try {
    assert.equal((await get(dash.port, '/files/2026-01-01-none/define.md')).status, 404);
    assert.equal(logged.mock.callCount(), 0);
  } finally {
    logged.mock.restore();
    await dash.close();
    rmSync(project, { recursive: true, force: true });
  }
});
