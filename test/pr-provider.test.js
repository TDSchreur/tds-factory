import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { can, providerFor, remoteRepo } from '../src/pr-provider.js';
import { defined as present } from './run-view.js';

// Reflect.apply passes arguments the types forbid, which a caller reading a record from disk can still hand over.
test('a GitHub PR link has a provider and nothing else does', () => {
  assert.equal(providerFor('https://github.com/o/r/pull/12')?.name, 'github');
  for (const url of [
    'https://github.com/o/r/pulls/12',
    'https://github.com/o/r/pull/x',
    'http://github.com/o/r/pull/1',
    '',
    undefined,
    null,
    42,
  ])
    assert.equal(Reflect.apply(providerFor, undefined, [url]), undefined, String(url));
});

test('a git remote resolves to its repository, or to nothing when it is not GitHub', () => {
  for (const remote of [
    'https://github.com/o/r.git',
    'https://github.com/o/r',
    'ssh://git@github.com/o/r.git',
    'ssh://github.com/o/r',
    'git@github.com:o/r.git',
    'http://github.com/o/r.git',
  ]) {
    const found = present(remoteRepo(remote), `${remote} is a repository`);
    assert.deepEqual([found.provider.name, found.owner, found.name], ['github', 'o', 'r'], remote);
  }
  for (const remote of ['', 'https://gitlab.com/o/r.git', 'https://github.com/o', 'file:///tmp/r'])
    assert.equal(remoteRepo(remote), undefined, remote);
});

test('only the provider adapter calls the gh command', () => {
  const callers = readdirSync('src').filter((file) =>
    /spawnSync\('gh'|exec\('gh'|execFile\('gh'|'gh',\s*\[/.test(readFileSync(join('src', file), 'utf8')),
  );
  assert.deepEqual(callers, ['pr-github.js']);
});

test('no provider can merge a PR', async () => {
  for (const url of ['https://github.com/o/r/pull/1', 'https://dev.azure.com/o/p/_git/r/pullrequest/1']) {
    assert.equal(can(url, 'merge'), false, url);
    assert.equal(Reflect.has(Object(providerFor(url)), 'merge'), false, url);
  }
});

test('an Azure DevOps link and remote have the Azure DevOps adapter', () => {
  assert.equal(providerFor('https://dev.azure.com/o/p/_git/r/pullrequest/12')?.name, 'azure-devops');
  const found = present(remoteRepo('https://dev.azure.com/o/p/_git/r'), 'the remote is a repository');
  assert.deepEqual([found.provider.name, found.owner, found.name], ['azure-devops', 'o/p', 'r']);
});

test('can tells which operations the adapter of a link has: Azure DevOps reads only', () => {
  const github = 'https://github.com/o/r/pull/1',
    azure = 'https://dev.azure.com/o/p/_git/r/pullrequest/1';
  for (const op of ['statusAsync', 'stateAsync', 'view', 'viewAsync', 'details', 'strictView', 'observe', 'listByHead'])
    assert.equal(can(github, op), true, op);
  for (const op of ['statusAsync', 'stateAsync', 'view', 'viewAsync', 'details'])
    assert.equal(can(azure, op), true, op);
  for (const op of ['strictView', 'observe', 'listByHead']) assert.equal(can(azure, op), false, op);
  for (const url of ['https://example.com/pr/1', '', undefined, null])
    assert.equal(Reflect.apply(can, undefined, [url, 'statusAsync']), false);
  assert.equal(can(github, 'toString'), false, 'only exported operations count');
  assert.equal(can(github, '__proto__'), false);
});
