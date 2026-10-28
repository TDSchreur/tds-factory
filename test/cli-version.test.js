import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('bin/tds-factory.js');
const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));

test('--version prints the package version on one line and exits with 0', () => {
  const result = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, version + '\n');
});

test('the usage text mentions --version', () => {
  const result = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.match(result.stdout, /tds-factory --version/);
});
