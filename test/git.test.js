// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, gitAsync } from '../src/git.js';

/** @returns {string} */
const tempRepo = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tds-git-'));
  git(dir, ['init', '-q']);
  return dir;
};

test('git returns text output from the given directory', () => {
  const dir = tempRepo();
  try {
    const out = git(dir, ['rev-parse', '--is-inside-work-tree']);
    assert.equal(out.status, 0);
    assert.equal(out.stdout.trim(), 'true');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('git passes options through to the process', () => {
  const dir = tempRepo();
  try {
    const out = git(dir, ['var', 'GIT_AUTHOR_IDENT'], {
      env: { ...process.env, GIT_AUTHOR_NAME: 'Zed Option', GIT_AUTHOR_EMAIL: 'z@example.com' },
    });
    assert.match(out.stdout, /^Zed Option /);
    const overflow = git(dir, ['--version'], { maxBuffer: 1 });
    assert.ok(overflow.error);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gitAsync resolves with the same shape as git on success', async () => {
  const dir = tempRepo();
  try {
    const out = await gitAsync(dir, ['rev-parse', '--is-inside-work-tree']);
    assert.equal(out.status, 0);
    assert.equal(out.stdout.trim(), 'true');
    assert.equal(out.error, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gitAsync resolves instead of rejecting when git fails', async () => {
  const dir = tempRepo();
  try {
    const out = await gitAsync(dir, ['rev-parse', '--verify', '-q', 'refs/heads/nope']);
    assert.notEqual(out.status, 0);
    assert.equal(typeof out.stderr, 'string');
    const missing = await gitAsync(path.join(dir, 'missing'), ['status']);
    assert.equal(missing.status, null);
    assert.ok(missing.error);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gitAsync closes stdin when no input is given, passes env and kills on timeout', async () => {
  const dir = tempRepo();
  try {
    const hashed = await gitAsync(dir, ['hash-object', '--stdin'], { timeout: 10_000 });
    assert.equal(hashed.status, 0);
    assert.match(hashed.stdout, /^[0-9a-f]{40,64}\n$/);
    const ident = await gitAsync(dir, ['var', 'GIT_AUTHOR_IDENT'], {
      env: { ...process.env, GIT_AUTHOR_NAME: 'Zed Async', GIT_AUTHOR_EMAIL: 'z@example.com' },
    });
    assert.match(ident.stdout, /^Zed Async /);
    // Run outside the temp repo: on Windows the killed child's shell can still hold its folder.
    const slow = await gitAsync(os.tmpdir(), ['-c', 'alias.slow=!sleep 5', 'slow'], { timeout: 100 });
    assert.equal(slow.status, null);
    assert.ok(slow.error);
    assert.equal(/** @type {Error & { timedOut?: boolean }} */ (slow.error).timedOut, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gitAsync keeps the overflow code and does not mark a maxBuffer overflow as a timeout', async () => {
  const out = await gitAsync(os.tmpdir(), ['-c', 'alias.big=!echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'big'], {
    maxBuffer: 4,
    timeout: 10_000,
  });
  const error = /** @type {Error & { code?: string, timedOut?: boolean }} */ (out.error);
  assert.ok(error);
  assert.equal(error.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  assert.notEqual(error.timedOut, true);
});

test('origin lookup names a timeout, but not a maxBuffer overflow, as "did not answer within"', async () => {
  const { originDefaultBranchFlow } = await import('../src/origin.js');
  /** @param {object} extra */
  const answer = (extra) => {
    const flow = originDefaultBranchFlow(os.tmpdir());
    flow.next();
    return /** @type {{ error?: string }} */ (
      flow.next({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('boom'), extra) }).value
    );
  };
  assert.match(answer({ timedOut: true }).error ?? '', /did not answer within 20s/);
  const overflow = answer({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true, signal: 'SIGTERM' });
  assert.equal(overflow.error, 'origin did not answer: boom');
});
