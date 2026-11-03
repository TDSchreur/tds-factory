import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { repo, linked, tempDir } from './git-repo.js';
import { projectId } from '../src/project-registry.js';

const cli = resolve('bin/tds-factory.js');
const START = JSON.stringify({ title: 'Example', agent: 'codex', commands: 'npm test', conventions: ['AGENTS.md'] });

/** @param {string} cwd @param {string} config @param {...string} args */
const factory = (cwd, config, ...args) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, TDS_FACTORY_CONFIG_DIR: config },
  });

test('a Run started in a worktree registers the main checkout', () => {
  const config = tempDir('config-');
  const main = repo();
  const result = factory(linked(main), config, 'run', 'start', '--data', START);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(config, 'projects.json'), 'utf8')), { projects: [main] });
});

test(
  'a Run starts when the registry cannot be written, with a warning',
  { skip: process.platform === 'win32' || process.getuid?.() === 0 },
  () => {
    const config = tempDir('config-');
    chmodSync(config, 0o500);
    const result = factory(repo(), config, 'run', 'start', '--data', START);
    chmodSync(config, 0o700);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /^warning: /m);
  },
);

test('the first dashboard call serves and a second one registers its Project, prints the URL and exits', async () => {
  const config = tempDir('config-');
  const a = repo();
  const b = repo();
  const first = spawn(process.execPath, [cli, 'dashboard'], {
    cwd: a,
    env: { ...process.env, TDS_FACTORY_CONFIG_DIR: config },
  });
  try {
    const line = await new Promise((ok, fail) => {
      let out = '';
      first.stdout.on('data', (chunk) => {
        out += chunk;
        if (out.includes('\n')) ok(out);
      });
      first.on('exit', () => fail(new Error('the first dashboard exited')));
    });
    const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(String(line))?.[0];
    assert.ok(url, String(line));
    assert.match(String(line), new RegExp(`\\?project=${projectId(a)}`));
    const second = factory(b, config, 'dashboard');
    assert.equal(second.status, 0, second.stderr);
    assert.ok(second.stdout.includes(`${url}?project=${projectId(b)}`), second.stdout);
    const projects = JSON.parse(readFileSync(join(config, 'projects.json'), 'utf8')).projects;
    assert.deepEqual(projects, [a, b]);
  } finally {
    first.kill('SIGTERM');
    await new Promise((ok) => first.on('exit', ok));
  }
  assert.equal(existsSync(join(config, 'dashboard.json')), false);
});
