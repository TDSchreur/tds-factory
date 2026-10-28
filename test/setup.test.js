import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = resolve('setup.sh');

// A PATH made only of stubs, so the script sees exactly the tools we give it.
function run({ nodeMajor = 20, npm = true, cli = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tds-setup-'));
  const log = join(dir, 'npm.log');
  const stub = (name, body) => {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  stub('node', `echo ${nodeMajor}`);
  mkdirSync(join(dir, 'lib', 'node_modules'), { recursive: true });
  if (npm) stub('npm', `if [ "$1" = prefix ]; then echo ${dir}; else echo "$PWD $*" >> ${log}; fi`);
  if (cli) stub('tds-factory', 'exit 0');
  for (const tool of ['dirname', 'cd', 'pwd']) {
    const real = spawnSync('sh', ['-c', `command -v ${tool}`]).stdout.toString().trim();
    if (real.startsWith('/')) stub(tool, `exec ${real} "$@"`);
  }
  const res = spawnSync('/bin/sh', [SCRIPT], { env: { PATH: dir }, cwd: tmpdir(), encoding: 'utf8' });
  return { ...res, log: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

test('installs globally from the repo root and suggests tds-factory install', () => {
  const r = run();
  assert.equal(r.status, 0);
  assert.equal(r.log.trim(), `${resolve('.')} install -g .`);
  assert.match(r.stdout, /tds-factory install/);
});

test('stops when node is older than 20', () => {
  const r = run({ nodeMajor: 18 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Node 20/);
  assert.equal(r.log, '');
});

test('stops when npm is missing', () => {
  const r = run({ npm: false });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /npm/);
});

test('warns when tds-factory is still not on PATH', () => {
  const r = run({ cli: false });
  assert.match(r.stderr, /PATH/);
});
