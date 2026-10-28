import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = resolve('setup.ps1');
const PWSH = spawnSync('sh', ['-c', 'command -v pwsh']).stdout.toString().trim();
const DOTNET = spawnSync('sh', ['-c', 'command -v dotnet']).stdout.toString().trim();
const opts = { skip: PWSH ? false : 'pwsh is not installed' };

// A PATH made only of stubs, so the script sees exactly the tools we give it.
function run({ nodeMajor = 20, npm = true, cli = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tds-setup-ps1-'));
  const log = join(dir, 'npm.log');
  const stub = (name, body) => {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  stub('node', `echo ${nodeMajor}`);
  if (npm) stub('npm', `if [ "$1" = prefix ]; then echo ${dir}; else echo "$PWD $*" >> ${log}; fi`);
  if (cli) stub('tds-factory', 'exit 0');
  // pwsh installed as a dotnet tool needs dotnet to start.
  if (DOTNET) symlinkSync(DOTNET, join(dir, 'dotnet'));
  const env = { ...process.env, PATH: dir };
  const res = spawnSync(PWSH, ['-NoProfile', '-File', SCRIPT], { env, cwd: tmpdir(), encoding: 'utf8' });
  return { ...res, log: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

test('installs globally from the repo root and suggests tds-factory install', opts, () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.log.trim(), `${resolve('.')} install -g .`);
  assert.match(r.stdout, /tds-factory install/);
});

test('stops when node is older than 20', opts, () => {
  const r = run({ nodeMajor: 18 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Node 20/);
  assert.equal(r.log, '');
});

test('stops when npm is missing', opts, () => {
  const r = run({ npm: false });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /npm/);
});

test('warns when tds-factory is still not on PATH', opts, () => {
  const r = run({ cli: false });
  assert.match(r.stderr, /PATH/);
});
