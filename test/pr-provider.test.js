import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { providerFor, remoteRepo } from '../src/pr-provider.js';

test('a GitHub PR link has a provider and nothing else does', () => {
  assert.equal(providerFor('https://github.com/o/r/pull/12').name, 'github');
  for (const url of ['https://github.com/o/r/pulls/12', 'https://github.com/o/r/pull/x', 'http://github.com/o/r/pull/1', 'https://dev.azure.com/o/p/_git/r/pullrequest/1', '', undefined, null, 42]) assert.equal(providerFor(url), undefined, String(url));
});

test('a git remote resolves to its repository, or to nothing when it is not GitHub', () => {
  for (const remote of ['https://github.com/o/r.git', 'https://github.com/o/r', 'ssh://git@github.com/o/r.git', 'ssh://github.com/o/r', 'git@github.com:o/r.git', 'http://github.com/o/r.git']) {
    const found = remoteRepo(remote);
    assert.deepEqual([found.provider.name, found.owner, found.name], ['github', 'o', 'r'], remote);
  }
  for (const remote of ['', 'https://gitlab.com/o/r.git', 'git@dev.azure.com:v3/o/p/r', 'https://github.com/o', 'file:///tmp/r']) assert.equal(remoteRepo(remote), undefined, remote);
});

test('only the provider adapter calls the gh command', () => {
  const callers = readdirSync('src').filter((file) => /spawnSync\('gh'|exec\('gh'|execFile\('gh'|'gh',\s*\[/.test(readFileSync(join('src', file), 'utf8')));
  assert.deepEqual(callers, ['pr-github.js']);
});
