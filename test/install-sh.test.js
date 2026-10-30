import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/install.sh');
const URL = 'https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz';
const hasSh = process.platform !== 'win32' && spawnSync('sh', ['-c', 'true']).status === 0;
const skip = hasSh ? false : 'sh is not available';

// The tools install.sh needs, linked into a bin folder that is the whole PATH of the run, so a real node or npm on the
// machine can never leak in. node, npm and tds-factory are stubs that record what they were asked to do.
function sandbox({ node = true, npm = true, major = '22', npmFails = '', cli = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'install-sh-test-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  for (const tool of ['sh', 'mktemp', 'grep', 'cat', 'rm', 'dirname']) {
    const found = ['/usr/bin', '/bin'].map((d) => join(d, tool)).find(existsSync);
    if (found) symlinkSync(found, join(bin, tool));
  }
  const calls = join(dir, 'calls');
  const stub = (name, body) => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  if (node) stub('node', `if [ "$1" = "--version" ]; then echo v${major}.1.0; else echo ${major}; fi`);
  if (npm) {
    stub('npm', [
      'echo "npm $*" >> "$CALLS"',
      npmFails === 'EACCES' ? 'echo "npm error code EACCES" >&2; exit 243' : npmFails ? 'echo "npm error boom" >&2; exit 1' : 'exit 0',
    ].join('\n'));
  }
  if (cli) stub('tds-factory', 'if [ "$1" = "--version" ]; then echo 9.9.9; else echo "tds-factory $*" >> "$CALLS"; fi');
  return {
    run: (env = {}, file = script) => {
      const result = spawnSync(join(bin, 'sh'), [file], { encoding: 'utf8', env: { PATH: bin, CALLS: calls, HOME: dir, ...env } });
      return { ...result, calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [] };
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('install.sh installs with npm from the latest Release URL, then installs the skills', { skip }, () => {
  const s = sandbox();
  try {
    const r = s.run();
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.calls, [`npm install -g --allow-remote=root ${URL}`, 'tds-factory install']);
    assert.match(r.stdout, /Done: tds-factory 9\.9\.9/);
    assert.match(r.stdout, /tds-factory doctor/);
  } finally { s.cleanup(); }
});

test('TDS_FACTORY_FORCE=1 adds --force', { skip }, () => {
  const s = sandbox();
  try {
    const r = s.run({ TDS_FACTORY_FORCE: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.calls.at(-1), 'tds-factory install --force');
  } finally { s.cleanup(); }
});

test('TDS_FACTORY_SKIP_SKILLS=1 skips the skills step', { skip }, () => {
  const s = sandbox();
  try {
    const r = s.run({ TDS_FACTORY_SKIP_SKILLS: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.calls, [`npm install -g --allow-remote=root ${URL}`]);
  } finally { s.cleanup(); }
});

test('install.sh stops before npm when node is missing, too old, or npm is missing', { skip }, () => {
  for (const [options, message] of [[{ node: false }, /node not found.*nodejs\.org/], [{ major: '18' }, /need 20 or newer/], [{ npm: false }, /npm not found.*nodejs\.org/]]) {
    const s = sandbox(options);
    try {
      const r = s.run();
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, message);
      assert.deepEqual(r.calls, []);
    } finally { s.cleanup(); }
  }
});

test('on EACCES install.sh prints the user-prefix and nvm fix and never suggests sudo', { skip }, () => {
  const s = sandbox({ npmFails: 'EACCES' });
  try {
    const r = s.run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /EACCES/);
    assert.match(r.stderr, /npm config set prefix ~\/\.local/);
    assert.match(r.stderr, /nvm/);
    assert.match(r.stderr, /Do not use sudo/);
    assert.doesNotMatch(r.stdout + r.stderr, /sudo (npm|-|sh)/);
    assert.deepEqual(r.calls, [`npm install -g --allow-remote=root ${URL}`], 'no retry, no skills step');
  } finally { s.cleanup(); }
});

test('another npm failure stops with its exit code in the message and skips the skills', { skip }, () => {
  const s = sandbox({ npmFails: 'other' });
  try {
    const r = s.run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /npm install failed \(exit 1\)/);
    assert.ok(!r.calls.some((c) => c.startsWith('tds-factory')));
  } finally { s.cleanup(); }
});

test('install.sh explains a tds-factory that is installed but not on PATH', { skip }, () => {
  const s = sandbox({ cli: false });
  try {
    const r = s.run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not on your PATH.*npm prefix -g/);
  } finally { s.cleanup(); }
});

test('a download cut off before the last line runs nothing, because everything is inside main', { skip }, () => {
  const s = sandbox();
  try {
    const text = readFileSync(script, 'utf8');
    const lastLine = text.lastIndexOf('main "$@"');
    assert.ok(lastLine > 0 && text.slice(lastLine).trim() === 'main "$@"', 'main is called on the last line');
    // Cut at every line break before the call, and in the middle of the npm line.
    const cuts = [...text.slice(0, lastLine).matchAll(/\n/g)].map((m) => m.index + 1).concat(text.indexOf('npm install -g') + 8);
    for (const cut of cuts) {
      const file = join(tmpdir(), `install-sh-cut-${process.pid}-${cut}.sh`);
      writeFileSync(file, text.slice(0, cut));
      try {
        const r = s.run({}, file);
        assert.deepEqual(r.calls, [], `cut at ${cut} ran ${r.calls.join(', ')}`);
      } finally { rmSync(file, { force: true }); }
    }
  } finally { s.cleanup(); }
});
