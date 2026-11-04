import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { promptDestinations } from '../src/install-prompt.js';

test('a first interactive selection chooses only the destinations named by the user', async () => {
  /** @type {Array<{agent: import('../src/run-record.js').AgentName, configDir?: string, skillsDir: string, installed?: boolean}>} */
  const candidates = [
    { agent: 'claude', configDir: '/home/user/.claude', skillsDir: '/home/user/.claude/skills', installed: false },
    {
      agent: 'claude',
      configDir: '/home/user/.claude-work',
      skillsDir: '/home/user/.claude-work/skills',
      installed: false,
    },
    { agent: 'codex', skillsDir: '/home/user/.codex/skills', installed: false },
  ];
  let displayed = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      displayed += chunk;
      callback();
    },
  });
  const selected = await promptDestinations({ candidates, previous: [], input: Readable.from(['2,3\n']), output });
  assert.deepEqual(selected, [{ agent: 'claude', configDir: '/home/user/.claude-work' }, { agent: 'codex' }]);
  assert.match(displayed, /\.claude-work/);
});

test('saved choices require confirmation, and end of input cancels', async () => {
  /** @type {Array<{agent: import('../src/run-record.js').AgentName, skillsDir: string}>} */
  const candidates = [{ agent: 'codex', skillsDir: '/home/user/.codex/skills' }];
  /** @type {Array<{agent: import('../src/run-record.js').AgentName}>} */
  const previous = [{ agent: 'codex' }];
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  assert.deepEqual(
    await promptDestinations({ candidates, previous, input: Readable.from(['yes\n']), output }),
    previous,
  );
  assert.deepEqual(await promptDestinations({ candidates, previous, input: Readable.from([]), output }), []);
});

test('invalid selections fail and control characters in displayed paths are neutralized', async () => {
  /** @type {Array<{agent: import('../src/run-record.js').AgentName, skillsDir: string}>} */
  const candidates = [{ agent: 'claude', skillsDir: '/home/user/\u001b[2Jfake' }];
  let displayed = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      displayed += chunk;
      callback();
    },
  });
  await assert.rejects(
    promptDestinations({ candidates, previous: [], input: Readable.from(['2\n']), output }),
    /invalid destination selection/,
  );
  assert.doesNotMatch(displayed, /\u001b/);
});

test('a user can enter an additional Claude directory', async () => {
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  assert.deepEqual(
    await promptDestinations({
      candidates: [{ agent: 'codex', skillsDir: '/home/user/.codex/skills' }],
      previous: [],
      input: Readable.from(['add:/home/user/alternate\n1,2\n']),
      output,
    }),
    [{ agent: 'codex' }, { agent: 'claude', configDir: '/home/user/alternate' }],
  );
});

test('explicit choices name the complete desired set and reject incompatible flags', async () => {
  const { explicitDestinations } = await import('../src/install-prompt.js');
  assert.deepEqual(
    explicitDestinations({ agent: 'claude,codex', claudeDirs: ['/home/user/.claude', '/home/user/.claude-work'] }),
    [
      { agent: 'claude', configDir: '/home/user/.claude' },
      { agent: 'claude', configDir: '/home/user/.claude-work' },
      { agent: 'codex' },
    ],
  );
  assert.throws(() => explicitDestinations({ agent: 'codex', claudeDirs: ['other'] }), /claude/i);
  assert.throws(() => explicitDestinations({ agent: 'codex', reuse: true }), /reuse/i);
  assert.throws(() => explicitDestinations({ reuse: true }), /saved/i);
  assert.equal(explicitDestinations({}), undefined);
});

test(
  'a noninteractive process without a controlling terminal fails with an actionable message',
  { skip: process.platform !== 'linux' },
  async () => {
    const result = spawnSync(
      'setsid',
      [
        process.execPath,
        '--input-type=module',
        '-e',
        "import { openInstallTerminal } from './src/install-prompt.js'; try { openInstallTerminal(); process.exitCode = 1; } catch (error) { console.log(error.message); }",
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--agent|--reuse-selection/);
  },
);

test('explicit all includes Copilot and project mode rejects custom Claude paths', async () => {
  const { explicitDestinations } = await import('../src/install-prompt.js');
  assert.deepEqual(explicitDestinations({ agent: 'all' }), [
    { agent: 'claude' },
    { agent: 'codex' },
    { agent: 'copilot' },
  ]);
  assert.throws(
    () => explicitDestinations({ agent: 'claude', claudeDirs: ['.claude-work'], project: true }),
    /global/i,
  );
  assert.throws(() => explicitDestinations({ agent: 'all,codex' }), /all/i);
  assert.throws(() => explicitDestinations({ agent: 'codex,codex' }), /duplicate/i);
});

test(
  'reads the controlling terminal instead of a piped standard input',
  {
    skip:
      process.platform !== 'linux'
        ? 'needs a Linux pseudo-terminal'
        : spawnSync('python3', ['--version']).error
          ? 'python3 is needed to open a pseudo-terminal'
          : false,
  },
  async () => {
    const driver = String.raw`
import os, pty, select, sys, time
r, w = os.pipe()
os.write(w, b'not a choice\n')
os.close(w)
pid, terminal = pty.fork()
if pid == 0:
    os.dup2(r, 0)
    os.close(r)
    code = "import { openInstallTerminal, promptDestinations } from './src/install-prompt.js'; const t=openInstallTerminal(); const answer=await promptDestinations({candidates:[{agent:'codex',skillsDir:'/x'}],previous:[],...t}); console.log('SELECTED:'+JSON.stringify(answer)); t.input.destroy(); t.output.destroy();"
    os.execv(sys.argv[1], [sys.argv[1], '--input-type=module', '-e', code])
os.close(r)
data = b''
sent = False
deadline = time.monotonic() + 5
while time.monotonic() < deadline:
    ready, _, _ = select.select([terminal], [], [], max(0, deadline-time.monotonic()))
    if not ready: break
    try: chunk = os.read(terminal, 65536)
    except OSError: break
    if not chunk: break
    data += chunk
    if not sent and b'Choose numbers' in data:
        os.write(terminal, b'1\n')
        sent = True
os.close(terminal)
finished, status = os.waitpid(pid, os.WNOHANG)
while not finished and time.monotonic() < deadline:
    select.select([], [], [], min(0.01, max(0, deadline-time.monotonic())))
    finished, status = os.waitpid(pid, os.WNOHANG)
if not finished:
    os.kill(pid, 9)
    os.waitpid(pid, 0)
    sys.exit('terminal child timed out')
print(data.decode(errors='replace'))
if os.waitstatus_to_exitcode(status) != 0: sys.exit('terminal child failed')
`;
    const result = spawnSync('python3', ['-c', driver, process.execPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 8000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SELECTED:\[{"agent":"codex"}\]/);
  },
);

test('project selection rejects custom Claude directories', async () => {
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  await assert.rejects(
    promptDestinations({ candidates: [], previous: [], project: true, input: Readable.from(['add:/other\n']), output }),
    /project/i,
  );
});

test('explicit choices bypass the terminal and reuse still requires saved choices', async () => {
  const { chooseDestinations } = await import('../src/install-prompt.js');
  const noTerminal = () => {
    throw new Error('terminal should not be opened');
  };
  assert.deepEqual(await chooseDestinations({ agent: 'copilot', candidates: [], terminal: noTerminal }), [
    { agent: 'copilot' },
  ]);
  await assert.rejects(chooseDestinations({ reuse: true, candidates: [], terminal: noTerminal }), /saved/i);
});

/** @param {string} text */
function sink(text = '') {
  const state = { text };
  const output = new Writable({
    write(chunk, _encoding, callback) {
      state.text += chunk;
      callback();
    },
  });
  return { state, output };
}

test('saved choices are preselected and legacy copies are marked apart from new candidates', async () => {
  const { state, output } = sink();
  await promptDestinations({
    candidates: [
      { agent: 'claude', configDir: '/h/.claude', skillsDir: '/h/.claude/skills', installed: true },
      { agent: 'claude', configDir: '/h/.claude-new', skillsDir: '/h/.claude-new/skills' },
      { agent: 'codex', skillsDir: '/h/.agents/skills', installed: true },
    ],
    previous: [{ agent: 'codex' }],
    input: Readable.from([]),
    output,
  });
  assert.match(state.text, /1\. \[ \] claude \/h\/\.claude\/skills \(legacy/);
  assert.match(state.text, /2\. \[ \] claude \/h\/\.claude-new\/skills\n/);
  assert.match(state.text, /3\. \[x\] codex \/h\/\.agents\/skills \(saved\)/);
});

test('an unanswered prompt gives up after the bounded wait and changes nothing', async () => {
  const { state, output } = sink();
  const never = new Readable({ read() {} });
  const started = Date.now();
  const selected = await promptDestinations({
    candidates: [{ agent: 'codex', skillsDir: '/h/.agents/skills' }],
    previous: [],
    input: never,
    output,
    timeoutMs: 20,
  });
  assert.deepEqual(selected, []);
  assert.ok(Date.now() - started < 5000);
  assert.match(state.text, /nothing was changed/);
  never.destroy();
});

test('a typed path with control characters is refused and never echoed', async () => {
  const { state, output } = sink();
  await assert.rejects(
    promptDestinations({
      candidates: [{ agent: 'codex', skillsDir: '/h/.agents/skills' }],
      previous: [],
      input: Readable.from(['add:/h/\u001b[2Jx\n']),
      output,
    }),
    /invalid destination path/,
  );
  assert.doesNotMatch(state.text, /\u001b/);
});

test('a typed path over 4096 characters is refused', async () => {
  const { output } = sink();
  await assert.rejects(
    promptDestinations({
      candidates: [],
      previous: [],
      input: Readable.from([`add:/${'a'.repeat(4100)}\n`]),
      output,
    }),
    /invalid destination path/,
  );
});

test('hostile numbers and very long answers are rejected without hanging', async () => {
  for (const answer of ['1,'.repeat(50000), '9'.repeat(5000), '-1', '1e3', '0x1']) {
    const { output } = sink();
    await assert.rejects(
      promptDestinations({
        candidates: [{ agent: 'codex', skillsDir: '/h/.agents/skills' }],
        previous: [],
        input: Readable.from([`${answer}\n`]),
        output,
      }),
      /invalid destination selection/,
    );
  }
});
