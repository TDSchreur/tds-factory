import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyInstallPaths } from '../src/trusted-install-paths.js';

const linuxOnly = { skip: process.platform !== 'linux' ? 'Linux POSIX permission policy' : false };
const nativeOnly = { skip: !['darwin', 'win32'].includes(process.platform) ? 'macOS and Windows ACL policy' : false };

test('accepts an ordinary private installation path on the native filesystem', nativeOnly, (t) => {
  const parent = fs.mkdtempSync(path.join(os.homedir(), '.trust-test-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const dir = path.join(parent, 'skills');
  fs.mkdirSync(dir, { mode: 0o700 });
  assert.doesNotThrow(() => verifyInstallPaths([dir, path.join(parent, 'new', 'record.json')], { recursive: true }));
});

test('rejects an ACL granting write access to an untrusted principal', nativeOnly, (t) => {
  const parent = fs.mkdtempSync(path.join(os.homedir(), '.trust-test-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const dir = path.join(parent, 'skills');
  fs.mkdirSync(dir, { mode: 0o700 });
  assert.doesNotThrow(() => verifyInstallPaths([dir], { recursive: true }));
  const result =
    process.platform === 'win32'
      ? spawnSync('icacls', [dir, '/grant', '*S-1-1-0:(OI)(CI)M'], { encoding: 'utf8', timeout: 5000 })
      : spawnSync('/bin/chmod', ['+a', 'everyone allow write', dir], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.throws(() => verifyInstallPaths([dir], { recursive: true }));
});

test('accepts private destination paths on a supported local filesystem', linuxOnly, (t) => {
  const parent = fs.mkdtempSync(path.join(process.cwd(), '.trust-test-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  fs.mkdirSync(path.join(parent, 'skills'));
  assert.doesNotThrow(() => verifyInstallPaths([path.join(parent, 'skills'), path.join(parent, 'new', 'record.json')]));
});

test('rejects writable ancestors, linked paths and special filesystem objects', linuxOnly, (t) => {
  const parent = fs.mkdtempSync(path.join(process.cwd(), '.trust-test-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const writable = path.join(parent, 'writable');
  fs.mkdirSync(writable);
  fs.chmodSync(writable, 0o777);
  assert.throws(() => verifyInstallPaths([path.join(writable, 'future')]), /writable by others/);
  fs.chmodSync(writable, 0o700);
  const link = path.join(parent, 'linked');
  fs.symlinkSync(writable, link);
  assert.throws(() => verifyInstallPaths([link]), /symbolic link/);
  assert.throws(() => verifyInstallPaths(['/proc/self/status']), /symbolic link|unsupported filesystem/);
  assert.throws(() => verifyInstallPaths(['relative']), /absolute/);
});

test('rejects untrusted files within an affected destination', linuxOnly, (t) => {
  const parent = fs.mkdtempSync(path.join(process.cwd(), '.trust-test-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const dir = path.join(parent, 'skills');
  fs.mkdirSync(dir);
  const file = path.join(dir, 'installed.md');
  fs.writeFileSync(file, 'content');
  fs.chmodSync(file, 0o666);
  assert.throws(() => verifyInstallPaths([dir], { recursive: true }), /writable by others/);
});

test('POSIX named-user ACL grants are reflected in the trust decision', linuxOnly, (t) => {
  const parent = fs.mkdtempSync(path.join(process.cwd(), '.trust-test-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const child = path.join(parent, 'acl-dir');
  fs.mkdirSync(child);
  const result = spawnSync('setfacl', ['-m', 'u:65534:rwx', child], { encoding: 'utf8', timeout: 5000 });
  if (result.error && 'code' in result.error && result.error.code === 'ENOENT') return t.skip('setfacl is unavailable');
  assert.equal(result.status, 0, result.stderr);
  assert.throws(() => verifyInstallPaths([child]), /writable by others/);
});

test('private creation prevents inherited default ACLs from granting write access', linuxOnly, (t) => {
  const parent = fs.mkdtempSync(path.join(process.cwd(), '.trust-test-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const result = spawnSync('setfacl', ['-d', '-m', 'u:65534:rwx', parent], { encoding: 'utf8', timeout: 5000 });
  if (result.error && 'code' in result.error && result.error.code === 'ENOENT') return t.skip('setfacl is unavailable');
  assert.equal(result.status, 0, result.stderr);
  const privateDir = path.join(parent, 'private');
  fs.mkdirSync(privateDir, { mode: 0o700 });
  assert.doesNotThrow(() => verifyInstallPaths([privateDir]));
  const unsafeDir = path.join(parent, 'unsafe');
  fs.mkdirSync(unsafeDir, { mode: 0o777 });
  assert.throws(() => verifyInstallPaths([unsafeDir]), /writable by others/);
});
