import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
