import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { resolveSelection, installFlags } from '../src/install.js';
import { explicitDestinations, NO_TERMINAL } from '../src/install-prompt.js';
import { privateDir } from './private-dir.js';

// These tests start the real binary: the terminal handling is decided by the process, not by a function call.
const bin = path.resolve('bin/tds-factory.js');
const linuxOnly = { skip: process.platform !== 'linux' ? 'needs a Linux controlling terminal (setsid, pty)' : false };
const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });
const pty = {
  skip:
    process.platform !== 'linux'
      ? 'needs a Linux pseudo-terminal'
      : python.error
        ? 'python3 is needed to open a pseudo-terminal'
        : false,
};

function world() {
  const base = privateDir('.install-cli-');
  const home = path.join(base, 'home');
  const project = path.join(base, 'project');
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(project, { mode: 0o700 });
  const env = { ...process.env, HOME: home, TDS_FACTORY_CONFIG_DIR: path.join(base, 'config') };
  return { home, project, env };
}

test('without a terminal the CLI prints the full command example and writes nothing', linuxOnly, () => {
  const w = world();
  const result = spawnSync('setsid', [process.execPath, bin, 'install'], {
    cwd: w.project,
    env: w.env,
    encoding: 'utf8',
    input: '',
    timeout: 20000,
    windowsHide: true,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Example: tds-factory install --agent claude,codex/);
  assert.match(result.stderr, /--reuse-selection/);
  assert.deepEqual(fs.readdirSync(w.home), []);
});

test('a script piped on standard input is never read as the answer when a terminal exists', pty, () => {
  const w = world();
  const driver = String.raw`
import os, pty, select, sys, time
node, binary, cwd = sys.argv[1:4]
r, write_end = os.pipe()
# If the pipe were read as the answer, 1 would install the first candidate.
os.write(write_end, b'1,2,3\n1\ny\n')
os.close(write_end)
pid, terminal = pty.fork()
if pid == 0:
    os.dup2(r, 0)
    os.close(r)
    os.chdir(cwd)
    os.execv(node, [node, binary, 'install'])
os.close(r)
data = b''
sent = False
deadline = time.monotonic() + 15
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
  const result = spawnSync('python3', ['-I', '-c', driver, process.execPath, bin, w.project], {
    env: w.env,
    encoding: 'utf8',
    timeout: 25000,
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /Choose numbers/);
  assert.match(result.stdout, /nothing selected; no changes were made/);
  assert.deepEqual(fs.readdirSync(w.home), []);
  assert.equal(fs.existsSync(path.join(w.project, '.claude')), false);
});

// The seam update uses: the choice is resolved once, serialized into install flags and parsed again by install.
const supported = { skip: !['linux', 'win32'].includes(process.platform) ? 'install needs Linux or Windows' : false };

/** A terminal that answers with these lines; the prompt only needs a readable and a writable stream.
 * @param {string[]} lines @returns {() => never} */
const answering = (lines) => () =>
  /** @type {never} */ (
    /** @type {unknown} */ ({
      input: Readable.from(lines),
      output: new Writable({ write: (_c, _e, done) => done() }),
      close() {},
    })
  );

/** @param {string[]} flags */
function parseFlags(flags) {
  const agent = flags[flags.indexOf('--agent') + 1];
  /** @type {string[]} */
  const claudeDirs = [];
  flags.forEach((flag, index) => {
    if (flag === '--claude-dir') claudeDirs.push(flags[index + 1]);
  });
  return { agent, claudeDirs };
}

/** @param {Record<string, unknown>} extra */
function seam(extra = {}) {
  const w = world();
  fs.mkdirSync(path.join(w.home, '.claude-work'), { mode: 0o700 });
  return { w, options: { home: w.home, cwd: w.project, env: w.env, ...extra } };
}

/** @param {{ agent: string, configDir?: string }[]} selected @param {{ agent: string, configDir?: string }[]} expected */
function sameSet(selected, expected) {
  const text = (/** @type {{ agent: string, configDir?: string }[]} */ list) =>
    list.map((item) => `${item.agent}:${item.configDir ?? ''}`).sort();
  assert.deepEqual(text(selected), text(expected));
}

test('a resolved selection survives the trip through install flags for every destination kind', supported, async () => {
  const { w, options } = seam();
  const claude = path.join(w.home, '.claude');
  const extra = path.join(w.home, '.claude-work');
  const cases = [
    'claude',
    'codex',
    'copilot',
    'all',
    'claude,codex',
    `claude+${extra}`,
    `claude+${claude}+${extra}`,
    `claude+${extra}+codex,copilot`,
  ];
  for (const text of cases) {
    const [names, ...dirs] = text.split('+');
    const resolved = await resolveSelection({
      ...options,
      agent: names === 'claude' && dirs.length ? 'claude' : names,
      claudeDirs: dirs,
    });
    assert.ok('selected' in resolved, text);
    const flags = installFlags(resolved.selected);
    const parsed = parseFlags(flags);
    const again = await resolveSelection({ ...options, ...parsed, claudeDirs: parsed.claudeDirs });
    assert.ok('selected' in again, text);
    sameSet(again.selected, resolved.selected);
    // The default Claude folder is named, so it is never lost beside extra folders.
    if (resolved.selected.some((item) => item.agent === 'claude')) assert.ok(flags.includes('--claude-dir'), text);
  }
});

test('a prompt answer with the default and an extra Claude folder is serialized without loss', supported, async () => {
  const { options } = seam();
  const resolved = await resolveSelection({ ...options, terminal: answering(['1,2\n']) });
  assert.ok('selected' in resolved);
  const { agent, claudeDirs } = parseFlags(installFlags(resolved.selected));
  assert.equal(agent, 'claude');
  assert.deepEqual(claudeDirs.map((dir) => path.basename(dir)).sort(), ['.claude', '.claude-work']);
});

test('cancellation and a missing terminal are not a choice and change nothing', supported, async () => {
  const { w, options } = seam();
  const cancelled = await resolveSelection({
    ...options,
    terminal: answering(['\n']),
  });
  assert.deepEqual(cancelled, { cancelled: true });
  const noTerminal = () => {
    throw Object.assign(new Error('No interactive terminal'), { code: NO_TERMINAL });
  };
  await assert.rejects(resolveSelection({ ...options, terminal: noTerminal }), (error) => {
    assert.equal(/** @type {{ code?: string }} */ (error).code, 'install-selection-required');
    assert.match(String(error), /Example: tds-factory install --agent claude,codex/);
    return true;
  });
  assert.deepEqual(fs.readdirSync(w.home), ['.claude-work']);
  assert.equal(fs.existsSync(w.env.TDS_FACTORY_CONFIG_DIR), false);
});

test('installFlags refuses a destination without a folder next to others it cannot name', () => {
  assert.deepEqual(installFlags([{ agent: 'codex' }, { agent: 'copilot' }]), ['--agent', 'codex,copilot']);
  assert.throws(
    () => installFlags([{ agent: 'claude' }, { agent: 'claude', configDir: '/x' }]),
    /default Claude folder/,
  );
  assert.deepEqual(explicitDestinations({ agent: 'claude' }), [{ agent: 'claude' }]);
});
