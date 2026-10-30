import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/install.ps1');
const source = readFileSync(script, 'utf8');
const URL = 'https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz';
const win = process.platform === 'win32';
// spawnSync looks the program up on the PATH given to the child, so find it on ours first.
const onPath = (name) => (process.env.PATH ?? '').split(delimiter).flatMap((d) => [join(d, name), join(d, `${name}.exe`)]).find(existsSync);
// INSTALL_PS1_SHELL picks the shell, since CI runs the file on both Windows PowerShell 5.1 and PowerShell 7.
const candidates = process.env.INSTALL_PS1_SHELL ? [process.env.INSTALL_PS1_SHELL] : win ? ['powershell', 'pwsh'] : ['pwsh', 'powershell'];
const pwsh = candidates.map(onPath).find((path) => path && spawnSync(path, ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status === 0);
const skip = pwsh ? false : 'PowerShell is not available';

test('CI has the PowerShell it asks for', { skip: !process.env.REQUIRE_POWERSHELL }, () => {
  assert.ok(pwsh, `REQUIRE_POWERSHELL is set but ${candidates.join(' or ')} was not found`);
});

// node, npm and tds-factory are stubs on a PATH of their own that record what they were asked to do, so a real node or
// npm on the machine never takes part. On Windows the stubs are .cmd files, elsewhere sh scripts.
function sandbox({ node = true, npm = true, major = '22', npmFails = false, cli = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'install-ps1-test-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  // A pwsh installed as a dotnet global tool starts through `dotnet` on PATH, so link just that one tool in behind the stubs.
  const host = join(dir, 'host');
  mkdirSync(host);
  const dotnet = win ? undefined : (process.env.PATH ?? '').split(delimiter).map((d) => join(d, 'dotnet')).find(existsSync);
  if (dotnet) symlinkSync(dotnet, join(host, 'dotnet'));
  const calls = join(dir, 'calls');
  const stub = (name, sh, cmd) => {
    if (win) writeFileSync(join(bin, `${name}.cmd`), `@echo off\r\n${cmd}\r\n`);
    else { writeFileSync(join(bin, name), `#!/bin/sh\n${sh}\n`); chmodSync(join(bin, name), 0o755); }
  };
  if (node) stub('node', `echo v${major}.1.0`, `echo v${major}.1.0`);
  if (npm) stub('npm', `echo "npm $*" >> "$CALLS"\n${npmFails ? 'exit 7' : 'exit 0'}`, `echo npm %*>> "%CALLS%"\r\n${npmFails ? 'exit /b 7' : 'exit /b 0'}`);
  if (cli) {
    stub('tds-factory', 'if [ "$1" = "--version" ]; then echo 9.9.9; else echo "tds-factory $*" >> "$CALLS"; fi',
      'if "%1"=="--version" (echo 9.9.9) else (echo tds-factory %*>> "%CALLS%")');
  }
  const base = win ? { SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT, ComSpec: process.env.ComSpec } : { DOTNET_ROOT: process.env.DOTNET_ROOT };
  return {
    run: (env = {}) => {
      const result = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-File', script], {
        encoding: 'utf8', env: { ...base, HOME: dir, USERPROFILE: dir, PATH: bin + delimiter + host, CALLS: calls, ...env },
      });
      return { ...result, calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split(/\r?\n/).map((l) => l.trim()) : [] };
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('install.ps1 installs with npm from the latest Release URL, then installs the skills', { skip }, () => {
  const s = sandbox();
  try {
    const r = s.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.calls, [`npm install -g --allow-remote=root ${URL}`, 'tds-factory install']);
    assert.match(r.stdout, /Done: tds-factory 9\.9\.9/);
    assert.match(r.stdout, /tds-factory doctor/);
  } finally { s.cleanup(); }
});

test('TDS_FACTORY_FORCE=1 adds --force', { skip }, () => {
  const s = sandbox();
  try {
    const r = s.run({ TDS_FACTORY_FORCE: '1' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.calls.at(-1), 'tds-factory install --force');
  } finally { s.cleanup(); }
});

test('TDS_FACTORY_SKIP_SKILLS=1 skips the skills step', { skip }, () => {
  const s = sandbox();
  try {
    const r = s.run({ TDS_FACTORY_SKIP_SKILLS: '1' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.calls, [`npm install -g --allow-remote=root ${URL}`]);
  } finally { s.cleanup(); }
});

test('install.ps1 stops before npm when node is missing, too old, or npm is missing, and exits non-zero', { skip }, () => {
  for (const [options, message] of [[{ node: false }, /node not found.*nodejs\.org/], [{ major: '18' }, /need 20 or newer/], [{ npm: false }, /npm not found.*nodejs\.org/]]) {
    const s = sandbox(options);
    try {
      const r = s.run();
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout + r.stderr, message);
      assert.deepEqual(r.calls, []);
    } finally { s.cleanup(); }
  }
});

test('a failing npm install stops with its exit code and skips the skills', { skip }, () => {
  const s = sandbox({ npmFails: true });
  try {
    const r = s.run();
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /npm install failed \(exit 7\)/);
    assert.ok(!r.calls.some((c) => c.startsWith('tds-factory')));
  } finally { s.cleanup(); }
});

test('install.ps1 explains a tds-factory that is installed but not on PATH', { skip }, () => {
  const s = sandbox({ cli: false });
  try {
    const r = s.run();
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /not on your PATH.*npm prefix -g/);
  } finally { s.cleanup(); }
});

test('install.ps1 only exits when run as a file, so irm | iex never closes the terminal', () => {
  assert.match(source, /if \(\$PSCommandPath\) \{ exit 1 \}/);
  assert.equal((source.match(/\{ exit \d+ \}|^\s*exit\b/gm) ?? []).length, 1, 'the one exit is the guarded one');
});

// Windows PowerShell 5.1 is what `powershell -c` runs, and it cannot be run here, so keep out the syntax it lacks.
test('install.ps1 avoids syntax that Windows PowerShell 5.1 does not have', () => {
  const code = source.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.doesNotMatch(code, /\?\?|\s\?\s|&&|\|\||-SkipHttpErrorCheck|-Parallel|\$IsWindows|\$IsLinux/);
});
