import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { install, runInstall } from '../src/install.js';
import { NO_TERMINAL } from '../src/install-prompt.js';
import { privateDir } from './private-dir.js';

// The real trusted-path check refuses temp folders (shared, sticky or unsupported filesystems), so these tests build
// their folders where the Linux and Windows checks accept a private location.
const supported = { skip: !['linux', 'win32'].includes(process.platform) ? 'install needs Linux or Windows' : false };
const symlinks = { skip: process.platform === 'win32' ? 'symlinks require Windows privileges' : false };
const posixOnly = { skip: process.platform !== 'linux' ? 'POSIX permission bits' : false };

function world() {
  const base = privateDir('.install-e2e-');
  const home = path.join(base, 'home');
  const project = path.join(base, 'project');
  const config = path.join(base, 'config');
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(project, { mode: 0o700 });
  const env = { TDS_FACTORY_CONFIG_DIR: config };
  /** @type {string[]} */
  const logs = [];
  /** @type {string[]} */
  const warnings = [];
  /** @param {Record<string, unknown>} [extra] */
  const options = (extra = {}) => ({
    home,
    cwd: project,
    env,
    log: (/** @type {string} */ m) => logs.push(m),
    warn: (/** @type {string} */ m) => warnings.push(m),
    ...extra,
  });
  const record = (/** @type {boolean} */ isProject = false) => {
    const dir = path.join(config, 'install');
    const file = isProject
      ? path.join(dir, 'projects', fs.readdirSync(path.join(dir, 'projects'))[0])
      : path.join(dir, 'global.json');
    return JSON.parse(fs.readFileSync(file, 'utf8')).selected;
  };
  return { base, home, project, config, env, logs, warnings, options, record };
}

/** @param {string} dir */
const has = (dir) => fs.existsSync(dir);

test('no destination is chosen silently: the error shows a command and nothing is written', supported, async () => {
  const w = world();
  const noTerminal = () => {
    throw Object.assign(new Error('No interactive terminal'), { code: NO_TERMINAL });
  };
  await assert.rejects(
    runInstall(w.options({ terminal: noTerminal })),
    /Example: tds-factory install --agent claude,codex/,
  );
  assert.throws(() => install(w.options({})), /tds-factory install --agent claude,codex/);
  assert.deepEqual(fs.readdirSync(w.home), []);
  assert.equal(has(w.config), false);
});

test('an explicit selection installs only there and saves the record', supported, () => {
  const w = world();
  install(w.options({ agent: 'claude,codex' }));
  assert.ok(has(path.join(w.home, '.claude', 'skills', 'tdd', 'SKILL.md')));
  assert.ok(has(path.join(w.home, '.claude', 'agents', 'factory-build.md')));
  assert.ok(has(path.join(w.home, '.agents', 'skills', 'tdd', 'SKILL.md')));
  assert.equal(has(path.join(w.home, '.copilot')), false);
  assert.deepEqual(w.record(), [{ agent: 'claude', configDir: path.join(w.home, '.claude') }, { agent: 'codex' }]);
});

test('files are created owner-only', { ...supported, ...posixOnly }, () => {
  const w = world();
  install(w.options({ agent: 'claude' }));
  const file = path.join(w.home, '.claude', 'agents', 'factory-build.md');
  assert.equal(fs.statSync(file).mode & 0o077, 0);
  assert.equal(fs.statSync(path.join(w.home, '.claude', 'skills', 'tdd')).mode & 0o077, 0);
  assert.equal(fs.statSync(path.join(w.config, 'install', 'global.json')).mode & 0o077, 0);
});

test('deselecting removes owned copies, backs up edits and keeps unrelated files', supported, () => {
  const w = world();
  install(w.options({ agent: 'claude,codex' }));
  const codexSkill = path.join(w.home, '.agents', 'skills', 'tdd');
  fs.writeFileSync(path.join(codexSkill, 'SKILL.md'), 'my edit');
  fs.writeFileSync(path.join(w.home, '.agents', 'skills', 'mine.txt'), 'unrelated');
  install(w.options({ agent: 'claude' }));
  assert.equal(has(codexSkill), false);
  assert.equal(fs.readFileSync(path.join(w.home, '.agents', 'skills', 'mine.txt'), 'utf8'), 'unrelated');
  assert.ok(has(path.join(w.home, '.claude', 'skills', 'tdd')));
  const backups = path.join(w.config, 'install-backups');
  const [run] = fs.readdirSync(backups);
  assert.equal(fs.readFileSync(path.join(backups, run, 'skills', 'tdd', 'SKILL.md'), 'utf8'), 'my edit');
  assert.deepEqual(w.record(), [{ agent: 'claude', configDir: path.join(w.home, '.claude') }]);
});

test('a legacy copy that is not selected is cleaned up too', supported, () => {
  const w = world();
  const legacy = path.join(w.home, '.claude-old', 'skills', 'tdd');
  fs.mkdirSync(legacy, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(legacy, 'SKILL.md'), 'old');
  fs.writeFileSync(path.join(legacy, '.tds-factory'), 'installed by old factory\n');
  install(w.options({ agent: 'codex' }));
  assert.equal(has(legacy), false);
});

test('dry run and cancellation write nothing, not even for a removal', supported, async () => {
  const w = world();
  install(w.options({ agent: 'claude,codex' }));
  const before = fs.readFileSync(path.join(w.config, 'install', 'global.json'), 'utf8');
  w.logs.length = 0;
  install(w.options({ agent: 'claude', dryRun: true }));
  assert.ok(has(path.join(w.home, '.agents', 'skills', 'tdd')));
  assert.ok(w.logs.some((line) => line.startsWith('would remove')));
  assert.equal(fs.readFileSync(path.join(w.config, 'install', 'global.json'), 'utf8'), before);
  const output = new Writable({ write: (_c, _e, done) => done() });
  await runInstall(w.options({ terminal: () => ({ input: Readable.from(['\n']), output, close() {} }) }));
  assert.ok(has(path.join(w.home, '.agents', 'skills', 'tdd')));
  assert.ok(w.logs.some((line) => /nothing selected/.test(line)));
});

test('an interactive answer chooses the destinations and saves them', supported, async () => {
  const w = world();
  fs.mkdirSync(path.join(w.home, '.claude-work'), { mode: 0o700 });
  const output = new Writable({ write: (_c, _e, done) => done() });
  const terminal = () => ({ input: Readable.from(['1,2\n']), output, close() {} });
  await runInstall(w.options({ terminal }));
  const saved = w.record();
  assert.equal(saved.length, 2);
  assert.ok(saved.every((/** @type {{agent: string}} */ item) => item.agent === 'claude'));
});

test('--claude-dir installs into each named Claude folder', supported, () => {
  const w = world();
  const a = path.join(w.home, '.claude-a');
  const b = path.join(w.home, 'elsewhere');
  install(w.options({ agent: 'claude', claudeDirs: [a, b] }));
  assert.ok(has(path.join(a, 'skills', 'tdd')));
  assert.ok(has(path.join(b, 'agents', 'factory-build.md')));
  assert.equal(has(path.join(w.home, '.claude')), false);
});

test('--reuse-selection needs a saved selection and then repeats it', supported, () => {
  const w = world();
  assert.throws(() => install(w.options({ reuseSelection: true })), /no saved selection/);
  install(w.options({ agent: 'codex' }));
  fs.rmSync(path.join(w.home, '.agents'), { recursive: true });
  install(w.options({ reuseSelection: true }));
  assert.ok(has(path.join(w.home, '.agents', 'skills', 'tdd')));
});

test('global and project selections are kept apart', supported, () => {
  const w = world();
  install(w.options({ agent: 'codex' }));
  install(w.options({ agent: 'claude', project: true }));
  assert.ok(has(path.join(w.home, '.agents', 'skills', 'tdd')));
  assert.ok(has(path.join(w.project, '.claude', 'skills', 'tdd')));
  assert.deepEqual(w.record(), [{ agent: 'codex' }]);
  assert.deepEqual(w.record(true), [{ agent: 'claude' }]);
});

test(
  'an untrusted location is refused before anything is installed, removed or saved',
  { ...supported, ...posixOnly },
  () => {
    const w = world();
    install(w.options({ agent: 'codex' }));
    const before = fs.readFileSync(path.join(w.config, 'install', 'global.json'), 'utf8');
    fs.chmodSync(w.home, 0o777);
    assert.throws(() => install(w.options({ agent: 'claude' })), /cannot establish that the install paths are trusted/);
    fs.chmodSync(w.home, 0o700);
    assert.equal(has(path.join(w.home, '.claude')), false);
    assert.ok(has(path.join(w.home, '.agents', 'skills', 'tdd')));
    assert.equal(fs.readFileSync(path.join(w.config, 'install', 'global.json'), 'utf8'), before);
  },
);

test(
  'a failing backup keeps the edited copy and the saved selection and says what was not done',
  {
    ...supported,
    skip:
      posixOnly.skip ||
      (process.getuid?.() === 0 ? 'root ignores the read-only folder that makes the backup fail' : false),
  },
  (t) => {
    const w = world();
    install(w.options({ agent: 'claude,codex' }));
    const edited = path.join(w.home, '.agents', 'skills', 'tdd', 'SKILL.md');
    fs.writeFileSync(edited, 'precious');
    const before = fs.readFileSync(path.join(w.config, 'install', 'global.json'), 'utf8');
    fs.mkdirSync(path.join(w.config, 'install-backups'), { mode: 0o500 });
    const backups = path.join(w.config, 'install-backups');
    t.after(() => fs.existsSync(backups) && fs.chmodSync(backups, 0o700));
    assert.throws(
      () => install(w.options({ agent: 'claude' })),
      (error) =>
        error instanceof Error &&
        /Not done: remove .*save the selection/.test(error.message) &&
        /Done: install/.test(error.message),
    );
    assert.equal(fs.readFileSync(edited, 'utf8'), 'precious');
    assert.equal(fs.readFileSync(path.join(w.config, 'install', 'global.json'), 'utf8'), before);
    // Running the command again after the cause is fixed finishes the cleanup and keeps the edit in a backup.
    fs.chmodSync(backups, 0o700);
    install(w.options({ agent: 'claude' }));
    assert.equal(fs.existsSync(edited), false);
    assert.deepEqual(w.record(), [{ agent: 'claude', configDir: path.join(w.home, '.claude') }]);
  },
);

test('an unavailable saved Claude folder can be deselected with a warning', supported, () => {
  const w = world();
  const gone = path.join(w.base, 'unmounted');
  fs.mkdirSync(gone, { mode: 0o700 });
  install(w.options({ agent: 'claude', claudeDirs: [gone] }));
  fs.rmSync(gone, { recursive: true });
  install(w.options({ agent: 'codex' }));
  assert.equal(has(path.join(w.home, '.agents', 'skills', 'tdd')), true);
  assert.equal(has(gone), false);
  assert.deepEqual(w.record(), [{ agent: 'codex' }]);
  assert.ok(w.warnings.some((message) => message.includes(gone) && /remain/.test(message)));
});

test('hostile path input is refused: control characters, very long paths and a NUL byte', supported, () => {
  const w = world();
  assert.throws(() => install(w.options({ agent: 'claude', claudeDirs: [`${w.home}/bad\u001b[2J`] })));
  assert.throws(() => install(w.options({ agent: 'claude', claudeDirs: ['a'.repeat(5000)] })));
  assert.throws(() => install(w.options({ agent: 'claude', claudeDirs: ['../x\0y'] })));
  assert.deepEqual(fs.readdirSync(w.home), []);
});

test(
  'a saved selection record that is a link is refused before anything is written',
  { ...supported, ...symlinks },
  () => {
    const w = world();
    install(w.options({ agent: 'codex' }));
    const file = path.join(w.config, 'install', 'global.json');
    const elsewhere = path.join(w.base, 'elsewhere.json');
    fs.renameSync(file, elsewhere);
    fs.symlinkSync(elsewhere, file);
    const before = fs.readFileSync(elsewhere, 'utf8');
    assert.throws(() => install(w.options({ agent: 'claude' })));
    assert.equal(fs.readFileSync(elsewhere, 'utf8'), before);
    assert.equal(has(path.join(w.home, '.claude')), false);
  },
);
