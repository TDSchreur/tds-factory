import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
 */
async function run(argv, cwd) {
  const stdout = sink();
  const stderr = sink();
  const status = await main(argv, { ...(cwd ? { cwd } : {}), stdout, stderr });
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
