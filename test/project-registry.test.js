import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { utimesSync } from 'node:fs';
import { platform } from 'node:os';
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
  assert.match(project?.id ?? '', /^[0-9a-f]{12}$/);
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

test('registry and file modes are private on non-Windows hosts', { skip: platform() === 'win32' }, () => {
  const { registry: reg, dir } = registry();
  reg.join(repo());
  reg.writeState({ pid: 1, port: 4300, version: '1.0.0' });
  assert.equal(lstatSync(dir).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(dir, 'projects.json')).mode & 0o777, 0o600);
  assert.equal(lstatSync(join(dir, 'dashboard.json')).mode & 0o777, 0o600);
});

test('an existing staging path is never followed', () => {
  const { registry: reg } = registry();
  const target = join(tempDir('registry-target-'), 'written-by-link');
  const trap = join(reg.dir, `projects.json.${process.pid}.tmp`);
  symlinkSync(target, trap);
  reg.join(repo());
  assert.equal(existsSync(target), false);
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

test('joins from many processes at once all survive', async () => {
  const dir = tempDir('registry-race-');
  const mains = Array.from({ length: 12 }, () => repo());
  const script = `import { openProjectRegistry } from ${JSON.stringify(new URL('../src/project-registry.js', import.meta.url).href)};
    const reg = openProjectRegistry({ dir: process.argv[1], warn: (m) => console.error(m) });
    if (!reg.join(process.argv[2])) process.exit(3);`;
  const codes = await Promise.all(
    mains.map(
      (main) =>
        new Promise((ok) => {
          const child = spawn(process.execPath, ['--input-type=module', '-e', script, dir, main], { stdio: 'inherit' });
          child.on('close', ok);
        }),
    ),
  );
  assert.deepEqual(
    codes,
    mains.map(() => 0),
  );
  assert.deepEqual(
    registry(dir)
      .registry.list()
      .map((p) => p.path)
      .sort(),
    [...mains].sort(),
  );
  assert.deepEqual(readdirSync(dir), ['projects.json']);
});

test('a stale lock left by a dead process does not block a join', () => {
  const { registry: reg, dir, warnings } = registry();
  const lock = join(dir, 'projects.json.lock');
  writeFileSync(lock, '1');
  const old = new Date(Date.now() - 60_000);
  utimesSync(lock, old, old);
  const main = repo();
  assert.equal(reg.join(main)?.path, main);
  assert.deepEqual(warnings, []);
  assert.equal(existsSync(lock), false);
});

test('a lock that stays held is a warning and the join gives up without throwing', () => {
  const { dir, warnings } = registry();
  writeFileSync(join(dir, 'projects.json.lock'), '1');
  const reg = openProjectRegistry({ dir, warn: (m) => warnings.push(m), lockWaitMs: 50 });
  assert.equal(reg.join(repo()), undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /locked/);
});

test('a lock that changed owners while held is not removed on release', async () => {
  const dir = tempDir('registry-lock-token-');
  const main = repo();
  const script = `import { openProjectRegistry } from ${JSON.stringify(new URL('../src/project-registry.js', import.meta.url).href)};
    const reg = openProjectRegistry({ dir: process.argv[1], lockWaitMs: 2000, warn: (m) => console.error(m) });
    reg.join(process.argv[2]);`;
  writeFileSync(join(dir, 'projects.json.lock'), 'foreign-token');
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(dir, 'projects.json.lock'), old, old);
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, dir, main], { stdio: 'pipe' });
  await new Promise((resolve) => setTimeout(resolve, 40));
  writeFileSync(join(dir, 'projects.json.lock'), 'other-owner');
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0);
  assert.equal(readFileSync(join(dir, 'projects.json.lock'), 'utf8'), 'other-owner');
});

test('join warns and keeps the first path when another path has the same id', () => {
  const { dir, warnings } = registry();
  const idOf = () => 'same-id';
  const reg = openProjectRegistry({ dir, warn: (m) => warnings.push(m), idOf });
  const first = join(tempDir('registry-collide-'), 'a');
  const second = join(tempDir('registry-collide-'), 'b');
  mkdirSync(first, { recursive: true });
  mkdirSync(second, { recursive: true });
  assert.deepEqual(reg.join(first), { id: 'same-id', path: first });
  assert.equal(reg.join(second), undefined);
  assert.deepEqual(reg.list(), [{ id: 'same-id', path: first }]);
  assert.match(warnings[0] ?? '', /same id/);
});

test('join from a non-repository path never throws and normalizes the path fallback', () => {
  const { registry: reg } = registry();
  const root = tempDir('registry-fallback-');
  const nested = join(root, 'a', '..', 'b');
  mkdirSync(nested, { recursive: true });
  const project = reg.join(nested);
  assert.deepEqual(project, { id: projectId(join(root, 'b')), path: join(root, 'b') });
});
