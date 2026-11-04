import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { privateDir } from './private-dir.js';
import { verifyInstallPaths } from '../src/trusted-install-paths.js';
import { install } from '../src/install.js';

const linuxOnly = { skip: process.platform !== 'linux' ? 'Linux POSIX permission policy' : false };

test('verification returns identities that a later check compares', linuxOnly, () => {
  const base = privateDir('.identity-test-');
  const dir = path.join(base, 'skills');
  fs.mkdirSync(dir, { mode: 0o700 });
  const guard = verifyInstallPaths([dir]);
  assert.doesNotThrow(() => guard.check(dir));
  fs.renameSync(dir, path.join(base, 'moved'));
  fs.mkdirSync(dir, { mode: 0o700 });
  assert.throws(() => guard.check(dir), /changed/);
  assert.throws(() => guard.check(path.join(dir, 'child')), /changed/);
});

test('a symbolic link that appears where nothing existed is refused', linuxOnly, () => {
  const base = privateDir('.identity-test-');
  const dir = path.join(base, 'future');
  const guard = verifyInstallPaths([dir]);
  fs.symlinkSync(base, dir);
  assert.throws(() => guard.check(dir), /changed/);
});

test('our own changes are adopted so a later check still passes', linuxOnly, () => {
  const base = privateDir('.identity-test-');
  const dir = path.join(base, 'a', 'skills');
  const guard = verifyInstallPaths([dir]);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  guard.adopt(dir);
  assert.doesNotThrow(() => guard.check(dir));
  fs.renameSync(path.join(base, 'a'), path.join(base, 'b'));
  fs.mkdirSync(path.join(base, 'a', 'skills'), { recursive: true, mode: 0o700 });
  assert.throws(() => guard.check(dir), /changed/);
});

test('swapping the skills folder between verification and use stops the install', linuxOnly, (t) => {
  const base = privateDir('.identity-test-');
  const home = path.join(base, 'home');
  const skills = path.join(home, '.agents', 'skills');
  fs.mkdirSync(skills, { recursive: true, mode: 0o700 });
  const decoy = path.join(base, 'decoy');
  fs.mkdirSync(decoy, { mode: 0o700 });
  let swapped = false;
  assert.throws(
    () =>
      install({
        agent: 'codex',
        home,
        cwd: base,
        env: { TDS_FACTORY_CONFIG_DIR: path.join(base, 'config') },
        warn() {},
        log(message) {
          if (!swapped && message.startsWith('installed codex/')) {
            swapped = true;
            fs.renameSync(skills, path.join(base, 'old-skills'));
            fs.symlinkSync(decoy, skills);
          }
        },
      }),
    /changed/,
  );
  assert.ok(swapped);
  assert.deepEqual(fs.readdirSync(decoy), []);
  t.diagnostic('the decoy folder stayed empty');
});
