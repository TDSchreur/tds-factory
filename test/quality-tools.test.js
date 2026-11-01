import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const read = (file) => readFileSync(resolve(file), 'utf8');
const scripts = JSON.parse(read('package.json')).scripts;

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
  const { include } = JSON.parse(read('tsconfig.json'));
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
  assert.deepEqual(outside, [], 'add the folder to the include list in tsconfig.json');
});
