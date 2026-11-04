import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { privateDir } from './private-dir.js';
import { resolvePwsh, verifyWindowsInstallPaths } from '../src/trusted-install-windows.js';

const windows = { skip: process.platform !== 'win32' ? 'needs real Windows ACLs and PowerShell 7' : false };

/** A fake Program Files folder holding a pwsh.exe, so the resolution runs on every platform. */
function fakeProgramFiles() {
  const root = privateDir('.trust-test-');
  const pwsh = path.join(root, 'PowerShell', '7', 'pwsh.exe');
  fs.mkdirSync(path.dirname(pwsh), { recursive: true });
  fs.writeFileSync(pwsh, '');
  return { root, pwsh };
}

test('pwsh is resolved from the fixed Program Files folder, never from PATH or the current directory', () => {
  const { root, pwsh } = fakeProgramFiles();
  const planted = privateDir('.trust-test-');
  fs.writeFileSync(path.join(planted, 'pwsh.exe'), '');
  assert.equal(resolvePwsh({ ProgramFiles: root, PATH: planted }), pwsh);
  assert.throws(() => resolvePwsh({ ProgramFiles: planted, PATH: planted }), /PowerShell 7 was not found/);
  assert.throws(() => resolvePwsh({ PATH: planted }), /PowerShell 7 was not found/);
  assert.throws(() => resolvePwsh({ ProgramFiles: 'relative', PATH: planted }), /not found/);
});

test('paths reach PowerShell as ASCII Base64 UTF-8, so no code page can change a name', () => {
  const { root } = fakeProgramFiles();
  const target = path.join(privateDir('.trust-test-'), 'ünï 日本語');
  fs.mkdirSync(target);
  /** @type {string | undefined} */
  let input;
  const spawn = /** @type {typeof spawnSync} */ (
    /** @type {unknown} */ (
      (/** @type {string} */ _command, /** @type {string[]} */ _args, /** @type {{input?: string}} */ options) => {
        input = options.input;
        return { status: 0, stdout: 'verified', stderr: '' };
      }
    )
  );
  verifyWindowsInstallPaths([target], false, { env: { ProgramFiles: root }, spawn });
  assert.ok(input);
  assert.match(input, /^[\x20-\x7e]*$/);
  const sent = JSON.parse(input).map((/** @type {{path: string}} */ entry) =>
    Buffer.from(entry.path, 'base64').toString('utf8'),
  );
  assert.ok(sent.includes(target));
});

test('a pwsh.exe that is a folder is not accepted', () => {
  const root = privateDir('.trust-test-');
  fs.mkdirSync(path.join(root, 'PowerShell', '7', 'pwsh.exe'), { recursive: true });
  assert.throws(() => resolvePwsh({ ProgramFiles: root }), /not found/);
});

test('the adapter starts the absolute pwsh with a system working directory and fails closed', () => {
  const { root, pwsh } = fakeProgramFiles();
  const target = privateDir('.trust-test-');
  /** @type {Array<{command: string, cwd?: string}>} */
  const calls = [];
  /** @param {string} stdout */
  const spawn = (stdout) =>
    /** @type {typeof spawnSync} */ (
      /** @type {unknown} */ (
        (/** @type {string} */ command, /** @type {string[]} */ _args, /** @type {{cwd?: string}} */ options) => {
          calls.push({ command, cwd: options.cwd });
          return { status: 0, stdout, stderr: '' };
        }
      )
    );
  const env = { ProgramFiles: root, SystemRoot: path.join(root, 'Windows') };
  const identities = verifyWindowsInstallPaths([target], false, { env, spawn: spawn('verified') });
  assert.ok(identities.has(target));
  assert.equal(calls[0].command, pwsh);
  assert.equal(calls[0].cwd, path.join(root, 'Windows', 'System32'));
  assert.throws(() => verifyWindowsInstallPaths([target], false, { env, spawn: spawn('') }), /cannot verify/);
  assert.throws(() => verifyWindowsInstallPaths([target], false, { env: {}, spawn: spawn('verified') }), /not found/);
});

test('a path that changes while PowerShell runs is refused', () => {
  const { root } = fakeProgramFiles();
  const base = privateDir('.trust-test-');
  const target = path.join(base, 'dir');
  fs.mkdirSync(target);
  const spawn = /** @type {typeof spawnSync} */ (
    /** @type {unknown} */ (
      () => {
        fs.renameSync(target, path.join(base, 'moved'));
        fs.mkdirSync(target);
        return { status: 0, stdout: 'verified', stderr: '' };
      }
    )
  );
  assert.throws(() => verifyWindowsInstallPaths([target], false, { env: { ProgramFiles: root }, spawn }), /changed/);
});

test('a path that does not survive UTF-8 is refused before PowerShell starts', () => {
  const { root } = fakeProgramFiles();
  const target = path.join(privateDir('.trust-test-'), 'bad\ud800name');
  let started = false;
  const spawn = /** @type {typeof spawnSync} */ (
    /** @type {unknown} */ (
      () => {
        started = true;
        return { status: 0, stdout: 'verified', stderr: '' };
      }
    )
  );
  assert.throws(() => verifyWindowsInstallPaths([target], false, { env: { ProgramFiles: root }, spawn }), /UTF-8/);
  assert.equal(started, false);
});

test('PowerShell gets a minimal environment', () => {
  const { root } = fakeProgramFiles();
  const target = privateDir('.trust-test-');
  /** @type {NodeJS.ProcessEnv | undefined} */
  let given;
  const spawn = /** @type {typeof spawnSync} */ (
    /** @type {unknown} */ (
      (/** @type {string} */ _c, /** @type {string[]} */ _a, /** @type {{env?: NodeJS.ProcessEnv}} */ options) => {
        given = options.env;
        return { status: 0, stdout: 'verified', stderr: '' };
      }
    )
  );
  const env = { ProgramFiles: root, SystemRoot: 'C:\\Windows', SECRET_TOKEN: 'x', PSModulePath: 'C:\\evil' };
  verifyWindowsInstallPaths([target], false, { env, spawn });
  assert.ok(given);
  assert.equal(given.SECRET_TOKEN, undefined);
  assert.equal(given.PSModulePath, undefined);
  assert.equal(given.SystemRoot, 'C:\\Windows');
  assert.equal(given.NoDefaultCurrentDirectoryInExePath, '1');
});

/** @param {string[]} args */
function icacls(...args) {
  return spawnSync('icacls', args, { encoding: 'utf8', timeout: 20000 });
}

/** Run a fixed PowerShell snippet that reads the folder from the environment, to build descriptors the Node API cannot.
 * @param {string} script @param {string} dir */
function pwshWith(script, dir) {
  return spawnSync(resolvePwsh(process.env), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 30000,
    cwd: process.env.SystemRoot,
    env: { ...process.env, TDS_TEST_DIR: dir },
  });
}

test('a private folder in the home folder is accepted, also with hostile and confusing names', windows, () => {
  const base = privateDir('.trust-test-');
  const names = ['[x] $(New-Item pwned) `;&', "it's {a} %PATH% ^!,=#@", '--help', 'con-1', 'ünï cödé', '日本語 фыв'];
  for (const name of names) fs.mkdirSync(path.join(base, name));
  assert.doesNotThrow(() => verifyWindowsInstallPaths([base], true));
  assert.equal(fs.existsSync(path.join(process.cwd(), 'pwned')), false);
  assert.equal(fs.existsSync(path.join(base, 'pwned')), false);
});

test('a junction is refused as a reparse point', windows, () => {
  const base = privateDir('.trust-test-');
  const real = path.join(base, 'real');
  fs.mkdirSync(real);
  const link = path.join(base, 'junction');
  fs.symlinkSync(real, link, 'junction');
  assert.throws(() => verifyWindowsInstallPaths([link], false), /Reparse point|cannot verify/);
  assert.throws(() => verifyWindowsInstallPaths([path.join(link, 'child')], false), /cannot verify/);
});

test('a folder owned by an untrusted principal is refused', windows, (t) => {
  const base = privateDir('.trust-test-');
  const dir = path.join(base, 'owned');
  fs.mkdirSync(dir);
  const result = icacls(dir, '/setowner', '*S-1-5-32-545');
  if (result.status !== 0) return t.skip(`cannot set an untrusted owner here: ${result.stderr || result.stdout}`);
  assert.throws(() => verifyWindowsInstallPaths([dir], false), /Untrusted owner/);
});

test('a folder with only a deny entry and no untrusted allow is still understood', windows, (t) => {
  const base = privateDir('.trust-test-');
  const dir = path.join(base, 'deny');
  fs.mkdirSync(dir);
  const result = icacls(dir, '/deny', '*S-1-1-0:(OI)(CI)(WD)');
  if (result.status !== 0) return t.skip(`cannot add a deny entry: ${result.stderr}`);
  assert.doesNotThrow(() => verifyWindowsInstallPaths([dir], false));
});

test('an allow for an untrusted principal is refused even when a deny would offset it', windows, (t) => {
  const base = privateDir('.trust-test-');
  const dir = path.join(base, 'both');
  fs.mkdirSync(dir);
  const grant = icacls(dir, '/grant', '*S-1-1-0:(OI)(CI)M');
  const deny = icacls(dir, '/deny', '*S-1-1-0:(OI)(CI)(WD,AD)');
  if (grant.status !== 0 || deny.status !== 0) return t.skip('cannot build the ACL here');
  assert.throws(() => verifyWindowsInstallPaths([dir], false), /Untrusted grant/);
});

test('a null DACL is refused', windows, (t) => {
  const base = privateDir('.trust-test-');
  const dir = path.join(base, 'null-dacl');
  fs.mkdirSync(dir);
  const script =
    '$d = $env:TDS_TEST_DIR; $acl = Get-Acl -LiteralPath $d; $acl.SetSecurityDescriptorSddlForm("D:NO_ACCESS_CONTROL"); Set-Acl -LiteralPath $d -AclObject $acl';
  const result = pwshWith(script, dir);
  if (result.status !== 0)
    return t.skip(`a null DACL cannot be set here (decision logic untested): ${result.stderr || result.stdout}`);
  assert.throws(() => verifyWindowsInstallPaths([dir], false), /cannot verify/);
});

test('a network path and a missing drive are refused as unverified volumes', windows, () => {
  assert.throws(() => verifyWindowsInstallPaths(['\\\\nonexistent-host.invalid\\share\\x'], false));
  assert.throws(() => verifyWindowsInstallPaths(['relative\\path'], false), /absolute/);
});

test(
  'a non-NTFS or removable volume is refused',
  { skip: 'no non-NTFS volume can be built on a hosted runner; the script rejects any volume that is not Fixed NTFS' },
  () => {},
);
