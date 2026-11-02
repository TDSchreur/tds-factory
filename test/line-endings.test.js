import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url);

test('.gitattributes checks every text file out with LF, whatever core.autocrlf says', () => {
  const rules = readFileSync(new URL('.gitattributes', root), 'utf8').split(/\r?\n/);
  assert.ok(rules.includes('* text=auto eol=lf'));
});

test('no tracked text file is stored with CRLF line endings', () => {
  const out = spawnSync('git', ['ls-files', '--eol'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  assert.equal(out.status, 0, out.stderr);
  const crlf = out.stdout.split(/\r?\n/).filter((line) => /^i\/(crlf|mixed)/.test(line));
  assert.deepEqual(crlf, []);
});
