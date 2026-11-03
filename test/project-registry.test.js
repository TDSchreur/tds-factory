import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openProjectRegistry, projectId, factoryConfigDir } from '../src/project-registry.js';
import { repo, linked, tempDir } from './git-repo.js';

/** @param {string} [dir] */
function registry(dir = tempDir('registry-')) {
  /** @type {string[]} */
  const warnings = [];
  return { dir, warnings, registry: openProjectRegistry({ dir, warn: (m) => warnings.push(m) }) };
}

test('a Project joins once and is listed with its id and path', () => {
  const { registry: reg, dir } = registry();
  const main = repo();
  const project = reg.join(main);
  reg.join(main);
  assert.deepEqual(project, { id: projectId(main), path: main });
  assert.deepEqual(reg.list(), [project]);
  assert.match(project?.id ?? '', /^[0-9a-f]{8}$/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')), { projects: [main] });
});

test('a Project joined from a subfolder or Run worktree is the main checkout', () => {
  const { registry: reg } = registry();
  const main = repo();
  const sub = join(main, 'sub');
  mkdirSync(sub);
  reg.join(linked(main));
  reg.join(sub);
  assert.deepEqual(
    reg.list().map((p) => p.path),
    [main],
  );
});

test('a Project leaves by its id and an unknown id changes nothing', () => {
  const { registry: reg } = registry();
  const a = repo();
  const b = repo();
  reg.join(a);
  reg.join(b);
  assert.equal(reg.remove('nope'), false);
  assert.equal(reg.remove(projectId(a)), true);
  assert.deepEqual(
    reg.list().map((p) => p.path),
    [b],
  );
});

test('a write leaves no temporary file behind', () => {
  const { registry: reg, dir } = registry();
  reg.join(repo());
  reg.writeState({ pid: 1, port: 4300, version: '1.0.0' });
  assert.deepEqual(readdirSync(dir).sort(), ['dashboard.json', 'projects.json']);
});

test('a corrupt registry reads as empty with a warning and is kept aside when a Project joins', () => {
  const { registry: reg, dir, warnings } = registry();
  writeFileSync(join(dir, 'projects.json'), '{ not json');
  assert.deepEqual(reg.list(), []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /projects\.json/);
  const main = repo();
  reg.join(main);
  assert.equal(readFileSync(join(dir, 'projects.json.corrupt'), 'utf8'), '{ not json');
  assert.deepEqual(
    reg.list().map((p) => p.path),
    [main],
  );
});

test('a registry that holds anything but a list of paths reads as empty with a warning', () => {
  const { registry: reg, dir, warnings } = registry();
  writeFileSync(join(dir, 'projects.json'), JSON.stringify({ projects: [1, '/ok'] }));
  assert.deepEqual(reg.list(), []);
  assert.equal(warnings.length, 1);
});

test(
  'a failed write is a warning and never throws',
  { skip: process.platform === 'win32' || process.getuid?.() === 0 },
  () => {
    const dir = tempDir('registry-ro-');
    chmodSync(dir, 0o500);
    const { registry: reg, warnings } = registry(dir);
    assert.equal(reg.join(repo()), undefined);
    assert.equal(warnings.length, 1);
    assert.equal(existsSync(join(dir, 'projects.json')), false);
    chmodSync(dir, 0o700);
  },
);

test('the state file round-trips and a damaged one reads as absent', () => {
  const { registry: reg, dir } = registry();
  assert.equal(reg.readState(), undefined);
  reg.writeState({ pid: 7, port: 4301, version: '1.2.3' });
  assert.deepEqual(reg.readState(), { pid: 7, port: 4301, version: '1.2.3' });
  writeFileSync(join(dir, 'dashboard.json'), JSON.stringify({ pid: 'x' }));
  assert.equal(reg.readState(), undefined);
  reg.writeState({ pid: 7, port: 4301, version: '1.2.3' });
  reg.clearState(8);
  assert.notEqual(reg.readState(), undefined);
  reg.clearState(7);
  assert.equal(reg.readState(), undefined);
});

test('the config folder follows XDG_CONFIG_HOME on Linux and a test override wins', () => {
  assert.equal(
    factoryConfigDir({ env: { XDG_CONFIG_HOME: '/x' }, platform: 'linux', home: '/h' }),
    join('/x', 'tds-factory'),
  );
  assert.equal(factoryConfigDir({ env: {}, platform: 'linux', home: '/h' }), join('/h', '.config', 'tds-factory'));
  assert.equal(
    factoryConfigDir({ env: { TDS_FACTORY_CONFIG_DIR: '/o', XDG_CONFIG_HOME: '/x' }, platform: 'linux', home: '/h' }),
    '/o',
  );
  assert.equal(factoryConfigDir({ env: { APPDATA: '/a' }, platform: 'win32', home: '/h' }), join('/a', 'tds-factory'));
  assert.equal(
    factoryConfigDir({ env: {}, platform: 'darwin', home: '/h' }),
    join('/h', 'Library', 'Application Support', 'tds-factory'),
  );
});
