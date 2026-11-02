import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, posix, resolve } from 'node:path';

const read = (file) => readFileSync(resolve(file), 'utf8');
const scripts = JSON.parse(read('package.json')).scripts;
// test/tsconfig.unchecked.json is temporary: it lists the test files that are not under the checkJs yet.
const PROJECTS = ['tsconfig.json', 'dashboard/tsconfig.json', 'test/tsconfig.json', 'test/tsconfig.unchecked.json'];

test('npm run check runs lint, format:check and typecheck, and the docs name it', () => {
  for (const name of ['lint', 'format:check', 'typecheck']) {
    assert.ok(scripts[name], `package.json has no ${name} script`);
    assert.ok(scripts.check.includes(`npm run ${name}`), `check does not run ${name}`);
  }
  for (const file of ['AGENTS.md', 'CONTRIBUTING.md', 'docs/development.md'])
    assert.match(read(file), /npm run check/, `${file} does not mention npm run check`);
});

test('every folder with tracked JavaScript is inside the lint, format and typecheck globs', () => {
  assert.equal(scripts.lint, 'eslint .');
  assert.match(scripts['format:check'], /"\*\*\/\*\.\{[^}]*\bjs\b[^}]*\}"/);
  const tracked = execFileSync('git', ['ls-files', '*.js'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  // Each project lists its folders relative to its own tsconfig; together they must cover every tracked file.
  const include = PROJECTS.flatMap((config) => {
    const dir = dirname(config);
    return JSON.parse(read(config)).include.map((glob) => posix.normalize(posix.join(dir, glob)));
  });
  const matches = (glob, file) =>
    new RegExp(
      '^' +
        glob
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*\//g, '(?:.*/)?')
          .replace(/\*/g, '[^/]*') +
        '$',
    ).test(file);
  const outside = tracked.filter(
    (file) =>
      !file.startsWith('vendor/') && !file.startsWith('dashboard/vendor/') && !include.some((g) => matches(g, file)),
  );
  assert.deepEqual(outside, [], 'add the folder to the include list of a tsconfig.json');
});

test('the typecheck runs the three projects and the temporary unchecked test project', () => {
  assert.equal(
    scripts.typecheck,
    'tsc -p tsconfig.json && tsc -p dashboard/tsconfig.json && tsc -p test/tsconfig.json && tsc -p test/tsconfig.unchecked.json',
  );
  const options = (config) => JSON.parse(read(config)).compilerOptions;
  assert.equal(options('tsconfig.json').checkJs, true);
  assert.equal(options('dashboard/tsconfig.json').checkJs, true);
  assert.equal(options('test/tsconfig.json').checkJs, true);
  assert.equal(options('test/tsconfig.unchecked.json').checkJs, false);
  assert.deepEqual(options('tsconfig.json').types, ['node']);
  assert.deepEqual(options('dashboard/tsconfig.json').types, [], 'the Dashboard runs in a browser: no Node types');
  assert.ok(options('dashboard/tsconfig.json').lib.includes('DOM'));
  for (const config of PROJECTS) assert.equal(options(config).strict, true, `${config} is not strict`);
  for (const config of ['tsconfig.json', 'test/tsconfig.json', 'test/tsconfig.unchecked.json']) {
    assert.equal(options(config).target, 'ES2024', `${config} does not target ES2024`);
    assert.deepEqual(options(config).lib, ['ES2024'], `${config} has a lib other than ES2024`);
  }
});

test('a test file is in exactly one of the checked and the unchecked test projects', () => {
  const included = (config) => new Set(JSON.parse(read(config)).include);
  const checked = included('test/tsconfig.json');
  for (const file of included('test/tsconfig.unchecked.json'))
    assert.ok(!checked.has(file), `${file} is in both test projects`);
});

test('the production code has no per-file opt-out from the typecheck', () => {
  const tracked = execFileSync('git', ['ls-files', 'bin', 'src', 'scripts', 'eval', 'dashboard/*.js'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => file.endsWith('.js') && !file.startsWith('dashboard/vendor/'));
  assert.ok(tracked.length > 20);
  const optOut = /@ts-(?:nocheck|ignore|expect-error)/;
  assert.deepEqual(
    tracked.filter((file) => optOut.test(read(file))),
    [],
  );
});
