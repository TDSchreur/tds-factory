import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('scripts/test-package.js says so when npm pack makes no tarball', () => {
  const bin = mkdtempSync(join(tmpdir(), 'fake-npm-'));
  const windows = process.platform === 'win32';
  if (windows) writeFileSync(join(bin, 'npm.cmd'), '@exit /b 0\r\n');
  else {
    writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(bin, 'npm'), 0o755);
  }
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` };
  delete env.npm_execpath; // set when this test runs under `npm test`: the real npm would pack
  const result = spawnSync(process.execPath, [resolve('scripts/test-package.js')], { encoding: 'utf8', env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /npm pack made no tarball/);
  assert.doesNotMatch(result.stderr, /TypeError/);
});
