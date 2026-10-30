import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { git } from './git-repo.js';

const SCRIPT = resolve('scripts/dev-install.js');
const posix = process.platform !== 'win32';

// A bare origin with one commit, plus a clone that has not seen the second commit yet.
function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tds-dev-')));
  const origin = join(base, 'origin.git');
  const seed = join(base, 'seed');
  const clone = join(base, 'clone');
  git(base, 'init', '-q', '--bare', '-b', 'trunk', origin);
  git(base, 'clone', '-q', origin, seed);
  writeFileSync(join(seed, 'package.json'), '{"name":"tds-factory","version":"1.0.0"}');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'one');
  git(seed, 'push', '-q', 'origin', 'HEAD:trunk');
  git(base, 'clone', '-q', origin, clone);
  writeFileSync(join(seed, 'new.txt'), 'merged later');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'two');
  git(seed, 'push', '-q', 'origin', 'HEAD:trunk');

  mkdirSync(join(clone, 'scripts'));
  copyFileSync(SCRIPT, join(clone, 'scripts', 'dev-install.js'));

  const bin = join(base, 'bin');
  mkdirSync(bin);
  const log = join(base, 'npm.log');
  writeFileSync(join(bin, 'npm'), `#!/bin/sh\ncase "$1" in --version) echo 10.0.0; exit 0;; prefix) echo /nonexistent; exit 0;; esac\necho "$*" >> ${log}\nfor a in "$@"; do last=$a; done\ntar tzf "$last" >> ${log}\n`);
  chmodSync(join(bin, 'npm'), 0o755);
  writeFileSync(join(bin, 'tds-factory'), `#!/bin/sh\necho "tds-factory $*" >> ${log}\n[ "$1" = --version ] && echo 9.9.9\nexit 0\n`);
  chmodSync(join(bin, 'tds-factory'), 0o755);
  return { base, clone, log, bin };
}

const run = (s, ...flags) => spawnSync(process.execPath, [join(s.clone, 'scripts', 'dev-install.js'), '--skip-dev-skills', ...flags], { cwd: s.clone, encoding: 'utf8', env: { ...process.env, PATH: `${s.bin}:${process.env.PATH}` } });

test('installs the tip of the default branch of origin, fetched without pulling', { skip: !posix }, () => {
  const s = setup();
  const r = run(s);
  assert.equal(r.status, 0, r.stderr);
  const log = readFileSync(s.log, 'utf8');
  assert.match(log, /^install -g /);
  assert.match(log, /package\/new\.txt/);
  assert.match(log, /^tds-factory install$/m, 'registers the Factory');
  assert.match(log, /^tds-factory doctor$/m);
  assert.equal(existsSync(join(s.clone, 'new.txt')), false, 'working tree untouched');
});

test('stops with an error when origin cannot be fetched', { skip: !posix }, () => {
  const s = setup();
  git(s.clone, 'remote', 'set-url', 'origin', join(s.base, 'missing.git'));
  const r = run(s);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /error:/);
  assert.equal(existsSync(s.log), false, 'npm never ran');
});

test('does not install or register anything on a dry run', { skip: !posix }, () => {
  const s = setup();
  const r = run(s, '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\$ tds-factory install/);
  assert.equal(existsSync(s.log), false, 'no command ran');
});

test('skips registering when the install fails, and exits non-zero', { skip: !posix }, () => {
  const s = setup();
  writeFileSync(join(s.bin, 'npm'), '#!/bin/sh\n[ "$1" = install ] && exit 1\necho 10.0.0\n');
  const r = run(s);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /skipped +Register the Factory|skipped Register the Factory/);
  assert.equal(existsSync(s.log), false, 'tds-factory never ran');
});

test('rejects unknown options', () => {
  const s = setup();
  const r = run(s, '--bogus');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown option/);
});
