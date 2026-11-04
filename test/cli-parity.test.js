import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo } from './git-repo.js';
import { cli } from './cli-runner.js';

const bin = resolve('bin/tds-factory.js');

// The unit tests run the CLI in process. This is the one place that holds the in-process result against the real binary,
// so the two cannot drift apart: an argument that is handled differently by `bin/tds-factory.js` shows here first.
for (const args of [
  ['--version'],
  [],
  ['frobnicate'],
  ['--frobnicate'],
  ['run', 'inspect', '--json'],
  ['run', 'inspect', '--id', 'nope'],
  ['run', 'config', '--id', 'nope'],
  ['install', '--dry-run', '--agent', 'claude'],
]) {
  test(`tds-factory ${args.join(' ')} gives the same status, stdout and stderr in process and as a spawned binary`, async () => {
    const cwd = repo();
    const spawned = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });
    const inProcess = await cli(cwd, ...args);
    assert.deepEqual(inProcess, { status: spawned.status, stdout: spawned.stdout, stderr: spawned.stderr });
  });
}
