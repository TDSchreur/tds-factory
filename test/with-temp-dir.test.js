import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const runner = resolve('scripts/with-temp-dir.js');
const run = (...command) => spawnSync(process.execPath, [runner, process.execPath, ...command], { encoding: 'utf8' });
// A command that leaks a folder with a file in it into the temp directory and reports where it is.
const leak = "const fs=require('fs'),os=require('os'),p=require('path');const d=fs.mkdtempSync(p.join(os.tmpdir(),'leak-'));fs.writeFileSync(p.join(d,'f'),'x');console.log(JSON.stringify({dir:d,tmpdir:os.tmpdir(),TMPDIR:process.env.TMPDIR,TMP:process.env.TMP,TEMP:process.env.TEMP}))";

test('the runner gives a command its own temp directory and removes it with everything the command left in it', () => {
  const result = run('-e', leak);
  assert.equal(result.status, 0);
  const seen = JSON.parse(result.stdout);
  assert.notEqual(seen.tmpdir, tmpdir(), 'not the shared temp directory');
  assert.equal(seen.TMPDIR, seen.tmpdir);
  assert.equal(seen.TMP, seen.TMPDIR);
  assert.equal(seen.TEMP, seen.TMPDIR);
  assert.ok(seen.dir.startsWith(seen.TMPDIR));
  assert.equal(existsSync(seen.dir), false, 'the leaked folder is gone');
  assert.equal(existsSync(seen.TMPDIR), false, 'and so is the temp directory');
});

test('the runner passes the exit code on and still removes the temp directory', () => {
  const result = run('-e', `${leak};process.exitCode=3`);
  assert.equal(result.status, 3);
  assert.equal(existsSync(JSON.parse(result.stdout).TMPDIR), false);
});

test('the runner reports a command that cannot start and fails', () => {
  const result = spawnSync(process.execPath, [runner, 'no-such-command-xyz'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no-such-command-xyz/);
});

test('the runner without a command fails and says how to use it', () => {
  const result = spawnSync(process.execPath, [runner], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage/i);
});

test('the test and eval scripts run through the runner', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const name of ['test', 'test:unit', 'test:browser', 'test:package', 'eval']) assert.match(scripts[name], /^node scripts\/with-temp-dir\.js /, name);
});

test('the shared git test helper removes its folders when its test process exits', () => {
  const file = join(tmpdir(), `repo-cleanup-${process.pid}.mjs`);
  writeFileSync(file, `import { repo, linked } from ${JSON.stringify(resolve('test/git-repo.js'))}; const main = repo(); const wt = linked(main); console.log(JSON.stringify([main, wt]));`);
  try {
    const result = spawnSync(process.execPath, [file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    for (const dir of JSON.parse(result.stdout)) assert.equal(existsSync(dir), false, dir);
  } finally { rmSync(file, { force: true }); }
});
