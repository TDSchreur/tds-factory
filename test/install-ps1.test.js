import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/install.ps1');
const source = readFileSync(script, 'utf8');
const URL = 'https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz';
const win = process.platform === 'win32';
// spawnSync looks the program up on the PATH given to the child, so find it on ours first.
const onPath = (name) => (process.env.PATH ?? '').split(delimiter).flatMap((d) => [join(d, name), join(d, `${name}.exe`)]).find(existsSync);
// Only PowerShell 7 is supported (ADR 0011).
const candidates = ['pwsh'];
const pwsh = candidates.map(onPath).find((path) => path && spawnSync(path, ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status === 0);
const skip = pwsh ? false : 'PowerShell is not available';

test('CI has the PowerShell it asks for', { skip: !process.env.REQUIRE_POWERSHELL }, () => {
  assert.ok(pwsh, `REQUIRE_POWERSHELL is set but ${candidates.join(' or ')} was not found`);
});

// node, npm and tds-factory are stubs on a PATH of their own that record what they were asked to do, so a real node or
// npm on the machine never takes part. On Windows the stubs are .cmd files, elsewhere sh scripts.
function sandbox({ node = true, npm = true, major = '22', npmFails = false, cli = true, shims = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'install-ps1-test-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  // A pwsh installed as a dotnet global tool starts through `dotnet` on PATH, so link just that one tool in behind the stubs.
  const host = join(dir, 'host');
  mkdirSync(host);
  const dotnet = win ? undefined : (process.env.PATH ?? '').split(delimiter).map((d) => join(d, 'dotnet')).find(existsSync);
  if (dotnet) symlinkSync(dotnet, join(host, 'dotnet'));
  // The npm.cmd stub below writes tds-factory.cmd the way a real install would, which needs these two tools.
  if (shims && !win) {
    for (const tool of ['chmod', 'dirname']) {
      const found = ['/usr/bin', '/bin'].map((d) => join(d, tool)).find(existsSync);
      if (found) symlinkSync(found, join(host, tool));
    }
  }
  const calls = join(dir, 'calls');
  const cwds = join(dir, 'cwds');
  const elsewhere = join(dir, 'untrusted-checkout');
  mkdirSync(elsewhere);
  const stub = (name, sh, cmd) => {
    if (win) writeFileSync(join(bin, `${name}.cmd`), `@echo off\r\n${cmd}\r\n`);
    else { writeFileSync(join(bin, name), `#!/bin/sh\n${sh}\n`); chmodSync(join(bin, name), 0o755); }
  };
  if (node) stub('node', `echo v${major}.1.0`, `echo v${major}.1.0`);
  if (npm) stub('npm', `echo "npm $*" >> "$CALLS"\necho "$PWD|\${NoDefaultCurrentDirectoryInExePath:-unset}" >> "$CWDS"\n${npmFails ? 'exit 7' : 'exit 0'}`, `echo npm %*>> "%CALLS%"\r\n${npmFails ? 'exit /b 7' : 'exit /b 0'}`);
  if (cli && !shims) {
    stub('tds-factory', 'if [ "$1" = "--version" ]; then echo 9.9.9; else echo "tds-factory $*" >> "$CALLS"; echo "$PWD|${NoDefaultCurrentDirectoryInExePath:-unset}" >> "$CWDS"; fi',
      'if "%1"=="--version" (echo 9.9.9) else (echo tds-factory %*>> "%CALLS%")');
  }
  // Next to the plain commands, the .cmd shims that npm also creates on Windows; PowerShell prefers the .ps1 ones, which
  // the default execution policy blocks, so the installer has to ask for the .cmd shims by name.
  if (shims) {
    // tds-factory.cmd appears only when npm installs it, as in real life, so the installer must choose it after the install.
    stub('npm.cmd', `echo "npm.cmd $*" >> "$CALLS"
printf '#!/bin/sh\\nif [ "$1" = "--version" ]; then echo 9.9.9; else echo "tds-factory.cmd $*" >> "$CALLS"; fi\\n' > "$(dirname "$0")/tds-factory.cmd"
chmod +x "$(dirname "$0")/tds-factory.cmd"`, '');
  }
  const base = win ? { SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT, ComSpec: process.env.ComSpec } : { DOTNET_ROOT: process.env.DOTNET_ROOT };
  return {
    dir,
    // `elsewhere` is the folder the user's terminal is in when they paste the line.
    run: (env = {}, { args = ['-File', script] } = {}) => {
      const result = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', ...args], {
        cwd: elsewhere, encoding: 'utf8', env: { ...base, HOME: dir, USERPROFILE: dir, PATH: bin + delimiter + host, CALLS: calls, CWDS: cwds, ...env },
      });
      return { ...result, cwds: existsSync(cwds) ? readFileSync(cwds, 'utf8').trim().split('\n') : [], calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split(/\r?\n/).map((l) => l.trim()) : [] };
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

test('install.ps1 calls the .cmd shims of npm and tds-factory when they exist', { skip: skip || (win && 'the Windows stubs are already .cmd files') }, () => {
  const s = sandbox({ shims: true });
  try {
    const r = s.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.calls, [`npm.cmd install -g --allow-remote=root ${URL}`, 'tds-factory.cmd install']);
  } finally { s.cleanup(); }
});

test('npm and tds-factory run in the home folder with NoDefaultCurrentDirectoryInExePath set, whatever folder the terminal is in', { skip: skip || (win && 'the Windows stubs do not log their folder') }, () => {
  const s = sandbox();
  try {
    const r = s.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.cwds.length >= 2, 'npm and tds-factory both logged');
    for (const line of r.cwds) assert.equal(line, `${realpathSync(s.dir)}|1`, 'home folder, switch on');
  } finally { s.cleanup(); }
});

test('after the install the terminal is back in its folder and the environment switch is as it was', { skip: skip || (win && 'the Windows stubs do not log their folder') }, () => {
  const s = sandbox();
  try {
    // Dot-sourced, as `irm | iex` runs it: in the caller's session, which must not be left changed.
    const r = s.run({}, { args: ['-Command', `. '${script}'; Write-Output ('after: ' + (Get-Location).Path + '|' + [string]$env:NoDefaultCurrentDirectoryInExePath + '|')`] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`after: ${join(realpathSync(s.dir), 'untrusted-checkout').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|\\|`));
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
