import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { privateDir } from './private-dir.js';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/install.sh');
const URL = 'https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz';
const hasSh = process.platform !== 'win32' && spawnSync('sh', ['-c', 'true']).status === 0;
const skip = hasSh ? false : 'sh is not available';

// The tools install.sh needs, linked into a bin folder that is the whole PATH of the run, so a real node or npm on the
// machine can never leak in. node, npm and tds-factory are stubs that record what they were asked to do.
/** @typedef {{ node?: boolean, npm?: boolean, major?: string, npmFails?: string, cli?: boolean, realCli?: boolean }} Options */
/** @param {Options} [options] */
function sandbox({ node = true, npm = true, major = '24', npmFails = '', cli = true, realCli = false } = {}) {
  const dir = realCli ? privateDir('.install-sh-') : mkdtempSync(join(tmpdir(), 'install-sh-test-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  for (const tool of ['sh', 'mktemp', 'grep', 'cat', 'rm', 'dirname']) {
    const found = ['/usr/bin', '/bin'].map((d) => join(d, tool)).find(existsSync);
    if (found) symlinkSync(found, join(bin, tool));
  }
  const calls = join(dir, 'calls');
  /**
   * @param {string} name
   * @param {string} body
   */
  const stub = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  if (node) stub('node', `if [ "$1" = "--version" ]; then echo v${major}.1.0; else echo ${major}; fi`);
  if (npm) {
    stub(
      'npm',
      [
        'echo "npm $*" >> "$CALLS"',
        npmFails === 'EACCES'
          ? 'echo "npm error code EACCES" >&2; exit 243'
          : npmFails
            ? 'echo "npm error boom" >&2; exit 1'
            : 'exit 0',
      ].join('\n'),
    );
  }
  // Every argument on a line of its own, so a folder with a space can be told from two arguments.
  if (cli && !realCli)
    stub(
      'tds-factory',
      'if [ "$1" = "--version" ]; then echo 9.9.9; else echo "tds-factory $*" >> "$CALLS"; printf "%s\\n" "$@" > "$CALLS.argv"; fi',
    );
  // The real CLI, for what only it decides: the terminal question, cancelling and the no-terminal failure.
  if (realCli) stub('tds-factory', `exec "${process.execPath}" "${resolve('bin/tds-factory.js')}" "$@"`);
  return {
    dir,
    bin,
    calls,
    /**
     * @param {NodeJS.ProcessEnv} [env]
     * @param {string} [file]
     * @param {{ args?: string[], piped?: boolean, wrap?: string[] }} [options] `piped` runs `sh -s -- args` with the script on standard input, as `curl | sh` does; `wrap` runs the shell under another program (setsid: no terminal).
     */
    run: (env = {}, file = script, { args = [], piped = false, wrap = [] } = {}) => {
      const shell = join(bin, 'sh');
      const argv = piped ? ['-s', '--', ...args] : [file, ...args];
      const [program, ...front] = wrap.length ? [...wrap, shell] : [shell];
      const result = spawnSync(program, [...front, ...argv], {
        encoding: 'utf8',
        input: piped ? readFileSync(file, 'utf8') : undefined,
        env: { PATH: bin, CALLS: calls, HOME: dir, TDS_FACTORY_CONFIG_DIR: join(dir, 'config'), ...env },
      });
      return {
        ...result,
        argv: existsSync(`${calls}.argv`) ? readFileSync(`${calls}.argv`, 'utf8').trimEnd().split('\n') : [],
        calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [],
      };
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
  } finally {
    s.cleanup();
  }
});

test('TDS_FACTORY_FORCE=1 adds --force', { skip }, () => {
  const s = sandbox();
  try {
    const r = s.run({ TDS_FACTORY_FORCE: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.calls.at(-1), 'tds-factory install --force');
  } finally {
    s.cleanup();
  }
});

test('TDS_FACTORY_SKIP_SKILLS=1 skips the skills step', { skip }, () => {
  const s = sandbox();
  try {
    const r = s.run({ TDS_FACTORY_SKIP_SKILLS: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.calls, [`npm install -g --allow-remote=root ${URL}`]);
  } finally {
    s.cleanup();
  }
});

test('install.sh stops before npm when node is missing, too old, or npm is missing', { skip }, () => {
  /** @type {[Options, RegExp][]} */
  const refused = [
    [{ node: false }, /node not found.*nodejs\.org/],
    [{ major: '22' }, /need 24 or newer/],
    [{ npm: false }, /npm not found.*nodejs\.org/],
  ];
  for (const [options, message] of refused) {
    const s = sandbox(options);
    try {
      const r = s.run();
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, message);
      assert.deepEqual(r.calls, []);
    } finally {
      s.cleanup();
    }
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
  } finally {
    s.cleanup();
  }
});

test('another npm failure stops with its exit code in the message and skips the skills', { skip }, () => {
  const s = sandbox({ npmFails: 'other' });
  try {
    const r = s.run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /npm install failed \(exit 1\)/);
    assert.ok(!r.calls.some((c) => c.startsWith('tds-factory')));
  } finally {
    s.cleanup();
  }
});

test('install.sh explains a tds-factory that is installed but not on PATH', { skip }, () => {
  const s = sandbox({ cli: false });
  try {
    const r = s.run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not on your PATH.*npm prefix -g/);
  } finally {
    s.cleanup();
  }
});

test('a download cut off before the last line runs nothing, because everything is inside main', { skip }, () => {
  const s = sandbox();
  try {
    const text = readFileSync(script, 'utf8');
    const lastLine = text.lastIndexOf('main "$@"');
    assert.ok(lastLine > 0 && text.slice(lastLine).trim() === 'main "$@"', 'main is called on the last line');
    // Cut at every line break before the call, and in the middle of the npm line.
    const cuts = [...text.slice(0, lastLine).matchAll(/\n/g)]
      .map((m) => m.index + 1)
      .concat(text.indexOf('npm install -g') + 8);
    for (const cut of cuts) {
      const file = join(s.dir, `cut-${cut}.sh`);
      writeFileSync(file, text.slice(0, cut));
      try {
        const r = s.run({}, file);
        assert.deepEqual(r.calls, [], `cut at ${cut} ran ${r.calls.join(', ')}`);
      } finally {
        rmSync(file, { force: true });
      }
    }
  } finally {
    s.cleanup();
  }
});

// Where the skills go: arguments, variables, and the terminal question of the real CLI.
const URL_CALL = `npm install -g --allow-remote=root ${URL}`;

test('arguments after sh -s -- reach tds-factory install unchanged', { skip }, () => {
  const s = sandbox();
  try {
    const r = s.run({}, script, { piped: true, args: ['--agent', 'claude,codex', '--claude-dir', '/a b/c'] });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.calls, [URL_CALL, 'tds-factory install --agent claude,codex --claude-dir /a b/c']);
    assert.deepEqual(r.argv, ['install', '--agent', 'claude,codex', '--claude-dir', '/a b/c']);
  } finally {
    s.cleanup();
  }
});

test('the destination variables become install flags, with --force before them', { skip }, () => {
  const s = sandbox();
  try {
    const r = s.run({ TDS_FACTORY_AGENT: 'claude,codex', TDS_FACTORY_CLAUDE_DIR: '/a b:/c', TDS_FACTORY_FORCE: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.argv, [
      'install',
      '--force',
      '--agent',
      'claude,codex',
      '--claude-dir',
      '/a b',
      '--claude-dir',
      '/c',
    ]);
    const reuse = s.run({ TDS_FACTORY_REUSE: '1' });
    assert.deepEqual(reuse.argv, ['install', '--reuse-selection']);
    // Nothing is validated here: a value that makes no sense is the CLI's to refuse.
    const odd = s.run({ TDS_FACTORY_AGENT: 'nonsense', TDS_FACTORY_CLAUDE_DIR: '*' });
    assert.deepEqual(odd.argv, ['install', '--agent', 'nonsense', '--claude-dir', '*']);
    // Only TDS_FACTORY_REUSE=1 counts; another value is not a choice.
    const none = s.run({ TDS_FACTORY_REUSE: '0' });
    assert.deepEqual(none.argv, ['install']);
  } finally {
    s.cleanup();
  }
});

test('arguments together with the variables are refused before npm runs', { skip }, () => {
  for (const env of [{ TDS_FACTORY_AGENT: 'codex' }, { TDS_FACTORY_CLAUDE_DIR: '/a' }, { TDS_FACTORY_REUSE: '1' }]) {
    const s = sandbox();
    try {
      const r = s.run(env, script, { args: ['--agent', 'claude'] });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /as arguments or as TDS_FACTORY_AGENT.*not both/);
      assert.deepEqual(r.calls, []);
    } finally {
      s.cleanup();
    }
  }
});

test('an empty entry in TDS_FACTORY_CLAUDE_DIR is refused before npm runs', { skip }, () => {
  for (const value of [':/a', '/a:', '/a::/b', ':']) {
    const s = sandbox();
    try {
      const r = s.run({ TDS_FACTORY_CLAUDE_DIR: value });
      assert.equal(r.status, 1, value);
      assert.match(r.stderr, /empty entry/);
      assert.deepEqual(r.calls, [], value);
    } finally {
      s.cleanup();
    }
  }
});

test('a failing tds-factory install after npm says the CLI is installed and how to continue', { skip }, () => {
  const s = sandbox();
  try {
    writeFileSync(
      join(s.bin, 'tds-factory'),
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 9.9.9; else exit 1; fi\n',
    );
    const r = s.run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /skills were not installed \(the CLI is\).*--agent claude,codex/);
  } finally {
    s.cleanup();
  }
});

const setsid = ['/usr/bin/setsid', '/bin/setsid'].find(existsSync);
const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });

/** What the real CLI must leave alone when nothing was chosen. @param {string} dir */
function assertNothingInstalled(dir) {
  for (const name of ['.claude', '.agents', '.codex', 'config'])
    assert.equal(existsSync(join(dir, name)), false, `${name} was not created`);
}

test(
  'without a terminal the script fails with the CLI example and installs no skills',
  {
    skip:
      skip ||
      (process.platform !== 'linux' && 'needs a Linux session without a controlling terminal') ||
      (!setsid && 'setsid is not available'),
  },
  () => {
    const s = sandbox({ realCli: true });
    try {
      const r = s.run({}, script, { piped: true, wrap: [/** @type {string} */ (setsid)] });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /Example: tds-factory install --agent claude,codex/);
      assert.match(r.stderr, /the skills were not installed/);
      assert.deepEqual(r.calls, [URL_CALL]);
      assertNothingInstalled(s.dir);
    } finally {
      s.cleanup();
    }
  },
);

test(
  'the question goes to the terminal, not to the script on stdin, and cancelling after npm changes nothing',
  {
    skip:
      skip ||
      (process.platform !== 'linux' && 'needs a Linux pseudo-terminal') ||
      (python.error && 'python3 is needed to open a pseudo-terminal'),
  },
  () => {
    const s = sandbox({ realCli: true });
    const driver = String.raw`
import json, os, pty, select, sys, time
shell, script, cwd, env = sys.argv[1], sys.argv[2], sys.argv[3], json.loads(sys.argv[4])
r, w = os.pipe()
os.write(w, open(script, 'rb').read())
os.close(w)
pid, terminal = pty.fork()
if pid == 0:
    os.dup2(r, 0)
    os.close(r)
    os.chdir(cwd)
    os.execve(shell, [shell, '-s'], env)
os.close(r)
data = b''
sent = False
deadline = time.monotonic() + 20
while time.monotonic() < deadline:
    ready, _, _ = select.select([terminal], [], [], max(0, deadline - time.monotonic()))
    if not ready: break
    try: chunk = os.read(terminal, 65536)
    except OSError: break
    if not chunk: break
    data += chunk
    if not sent and b'Choose numbers' in data:
        os.write(terminal, b'\n')
        sent = True
os.close(terminal)
finished, status = os.waitpid(pid, os.WNOHANG)
while not finished and time.monotonic() < deadline:
    select.select([], [], [], 0.01)
    finished, status = os.waitpid(pid, os.WNOHANG)
if not finished:
    os.kill(pid, 9)
    os.waitpid(pid, 0)
    sys.exit('terminal child timed out')
print(data.decode(errors='replace'))
sys.exit(os.waitstatus_to_exitcode(status))
`;
    try {
      const env = { PATH: s.bin, CALLS: s.calls, HOME: s.dir, TDS_FACTORY_CONFIG_DIR: join(s.dir, 'config') };
      const r = spawnSync('python3', ['-I', '-c', driver, join(s.bin, 'sh'), script, s.dir, JSON.stringify(env)], {
        encoding: 'utf8',
        timeout: 30000,
      });
      assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
      assert.match(r.stdout, /Choose numbers/);
      assert.match(r.stdout, /nothing selected; no changes were made/);
      assert.match(r.stdout, /Done: tds-factory/);
      assert.deepEqual(readFileSync(s.calls, 'utf8').trim().split('\n'), [URL_CALL]);
      assertNothingInstalled(s.dir);
    } finally {
      s.cleanup();
    }
  },
);
