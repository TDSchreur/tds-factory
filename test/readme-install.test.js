import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readme = readFileSync(resolve('README.md'), 'utf8');
const setup = readme.slice(readme.indexOf('## Setup'), readme.indexOf('## Dashboard'));

test('the README starts Setup with the install and update command from the latest Release', () => {
  const url = 'https://github.com/TDSchreur/tds-factory/releases/latest/download/tds-factory.tgz';
  assert.ok(setup.indexOf('npm install -g --allow-remote=root ' + url) > -1, 'install command present');
  assert.ok(setup.indexOf('npm install -g --allow-remote=root ' + url) < setup.indexOf('setup.sh'), 'before the checkout route');
  assert.match(setup, /same `npm install` command again to update/);
  assert.match(setup, /tds-factory --version/);
  assert.match(setup, /not installed automatically/);
});
