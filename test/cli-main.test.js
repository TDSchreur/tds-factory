import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { git, repo } from './git-repo.js';
import { main } from '../src/cli.js';

const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));

/** A sink that keeps what is written to it. */
const sink = () => {
  /** @type {string[]} */
  const chunks = [];
  return { write: (/** @type {string} */ chunk) => chunks.push(chunk), text: () => chunks.join('') };
};

/**
 * Runs `main` with collecting sinks.
 * @param {string[]} argv
 * @param {string} [cwd]
 * @param {NodeJS.ProcessEnv} [env]
 */
async function run(argv, cwd, env) {
  const stdout = sink();
  const stderr = sink();
  const status = await main(argv, { ...(cwd ? { cwd } : {}), ...(env ? { env } : {}), stdout, stderr });
  return { status, stdout: stdout.text(), stderr: stderr.text() };
}

test('--version prints the version on one line to stdout and returns 0', async () => {
  const result = await run(['--version']);
  assert.deepEqual(result, { status: 0, stdout: `${version}\n`, stderr: '' });
});

test('no command prints the usage and returns 0; an unknown command prints it and returns 1', async () => {
  const none = await run([]);
  assert.equal(none.status, 0);
  assert.match(none.stdout, /^Usage:\n/);
  assert.equal(none.stderr, '');
  const unknown = await run(['frobnicate']);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stdout, /tds-factory --version/);
});

test('an error goes to stderr as one line, with control characters shown as ?, and returns 1', async () => {
  const result = await run(['run', 'inspect', '--id', 'bad\u0007id'], repo());
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'error: no such Run: bad?id\n');
});

test('an option that does not exist is an error and returns 1', async () => {
  const result = await run(['--frobnicate']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^error: .*--frobnicate/);
});

test('run start and run inspect work in process, in the given working directory', async () => {
  const cwd = repo();
  git(cwd, 'config', 'user.name', 't');
  git(cwd, 'config', 'user.email', 't@t');
  const started = await run(
    [
      'run',
      'start',
      '--data',
      JSON.stringify({ title: 'Example', agent: 'claude', commands: 'true', conventions: [] }),
    ],
    cwd,
  );
  assert.equal(started.status, 0, started.stderr);
  const id = started.stdout.trim();
  assert.match(id, /^\d{4}-\d{2}-\d{2}-example$/);
  const inspected = await run(['run', 'inspect', '--id', id, '--json'], cwd);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(JSON.parse(inspected.stdout)[0].id, id);
});

test('main never sets process.exitCode, also when a command fails', async () => {
  const before = process.exitCode;
  const result = await run(['frobnicate']);
  assert.equal(result.status, 1);
  assert.equal(process.exitCode, before);
});

test('a command that prints from src/ prints to the sink and not to the console', async () => {
  /** @type {unknown[][]} */
  const written = [];
  const log = console.log;
  console.log = (...args) => written.push(args);
  try {
    const result = await run(['install', '--dry-run', '--agent', 'claude']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /would install/);
  } finally {
    console.log = log;
  }
  assert.deepEqual(written, []);
});

/**
 * A repository with a Run that has a fast Verify command.
 * @param {string} fast
 */
async function runWith(fast) {
  const cwd = repo();
  git(cwd, 'config', 'user.name', 't');
  git(cwd, 'config', 'user.email', 't@t');
  const started = await run(
    [
      'run',
      'start',
      '--data',
      JSON.stringify({ title: 'Env', agent: 'claude', commands: 'true', fast_commands: fast, conventions: [] }),
    ],
    cwd,
  );
  assert.equal(started.status, 0, started.stderr);
  return { cwd, id: started.stdout.trim() };
}

test('the environment of the call reaches the commands it runs, and the process gets its own back', async () => {
  const { cwd, id } = await runWith('node -p "\'marker=\' + process.env.TDS_TEST_MARKER"'); // cmd.exe on Windows does not expand $VARIABLE
  assert.equal(process.env.TDS_TEST_MARKER, undefined);
  const verified = await run(['run', 'verify', '--id', id, '--fast'], cwd, { ...process.env, TDS_TEST_MARKER: 'one' });
  assert.equal(verified.status, 0, verified.stderr);
  const log = readFileSync(join(cwd, '.factory', 'runs', id, 'verify-fast.log'), 'utf8');
  assert.match(log, /marker=one/);
  assert.equal(process.env.TDS_TEST_MARKER, undefined);
});

test('a variable the process had is restored after a call that changed or removed it', async () => {
  process.env.TDS_TEST_KEPT = 'before';
  process.env.TDS_TEST_REMOVED = 'before';
  try {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env, TDS_TEST_KEPT: 'during', TDS_TEST_ADDED: 'during' };
    delete env.TDS_TEST_REMOVED;
    const result = await run(['--version'], undefined, env);
    assert.equal(result.status, 0);
    assert.equal(process.env.TDS_TEST_KEPT, 'before');
    assert.equal(process.env.TDS_TEST_REMOVED, 'before');
    assert.equal(process.env.TDS_TEST_ADDED, undefined);
  } finally {
    delete process.env.TDS_TEST_KEPT;
    delete process.env.TDS_TEST_REMOVED;
  }
});

test('the working directory is the one of the call during it and the process gets its own back', async () => {
  const before = process.cwd();
  const cwd = repo();
  const result = await run(['run', 'inspect', '--json'], cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(process.cwd(), before);
});

test('a call that cannot start leaves the working directory and the environment as they were', async () => {
  const before = { cwd: process.cwd(), env: { ...process.env } };
  await assert.rejects(main(['--version'], { cwd: join(repo(), 'does-not-exist'), env: { ONLY: 'this' } }), {
    code: 'ENOENT',
  });
  assert.equal(process.cwd(), before.cwd);
  assert.deepEqual({ ...process.env }, before.env);
});

test('two calls that overlap each see their own working directory', async () => {
  const [a, b] = [repo(), repo()];
  for (const [cwd, title] of [
    [a, 'Alpha'],
    [b, 'Beta'],
  ]) {
    git(cwd, 'config', 'user.name', 't');
    git(cwd, 'config', 'user.email', 't@t');
    const started = await run(
      ['run', 'start', '--data', JSON.stringify({ title, agent: 'claude', commands: 'true', conventions: [] })],
      cwd,
    );
    assert.equal(started.status, 0, started.stderr);
  }
  const [first, second] = await Promise.all([
    run(['run', 'inspect', '--json'], a),
    run(['run', 'inspect', '--json'], b),
  ]);
  assert.match(first.stdout, /alpha/);
  assert.doesNotMatch(first.stdout, /beta/);
  assert.match(second.stdout, /beta/);
  assert.doesNotMatch(second.stdout, /alpha/);
});
