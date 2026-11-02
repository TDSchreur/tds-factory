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
    const out = git(dir, ['var', 'GIT_AUTHOR_IDENT'], { env: { ...process.env, GIT_AUTHOR_NAME: 'Zed Option' } });
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
