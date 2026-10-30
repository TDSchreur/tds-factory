import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readme = readFileSync(resolve('README.md'), 'utf8');
const setup = readme.slice(readme.indexOf('## Setup'), readme.indexOf('\n## ', readme.indexOf('## Setup') + 1));

const base = 'https://github.com/TDSchreur/tds-factory/releases/latest/download/';
const curl = `curl -fsSL ${base}install.sh | sh`;
const irm = `pwsh -c "irm ${base}install.ps1 | iex"`;
const manual = `npm install -g --allow-remote=root ${base}tds-factory.tgz`;
const guide = readFileSync(resolve('docs/install.md'), 'utf8');
const install = guide.slice(guide.indexOf('## 2. Install the Factory'), guide.indexOf('## 3.'));
const update = guide.slice(guide.indexOf('## 4. Update'), guide.indexOf('## 5.'));

test('the README starts Setup with the two one-liners, then the manual commands, and leaves the checkout route to the development guide', () => {
  for (const line of [curl, irm]) assert.ok(setup.includes(line), `${line} present`);
  assert.ok(setup.indexOf(curl) < setup.indexOf(irm));
  assert.ok(setup.indexOf(irm) < setup.indexOf(manual), 'one-liners come before the manual commands');
  assert.ok(!readme.includes('dev-install.js'), 'the checkout route lives in docs/development.md');
  assert.match(setup, /tds-factory --version/);
  assert.match(setup, /not installed automatically/);
});

test('the README explains update, its --force default and --no-force', () => {
  assert.match(setup, /`tds-factory update`/);
  assert.match(setup, /--no-force/);
  assert.match(setup, /replaces agent files and skills you edited/);
  assert.match(setup, /skill folder of the same name that `tds-factory` did not install/);
  assert.match(setup, /`TDS_FACTORY_FORCE=1`/);
});

test('the install guide starts part 2 with the one-liners and keeps the manual commands', () => {
  for (const line of [curl, irm, manual]) assert.ok(install.includes(line), `${line} in part 2`);
  assert.ok(install.indexOf(curl) < install.indexOf(manual));
  assert.ok(install.indexOf(irm) < install.indexOf(manual));
  assert.ok(update.includes('tds-factory update'), 'part 4 names tds-factory update');
  assert.match(update, /--no-force/);
  assert.match(guide, /one-line install fails|one-liner fails/i);
});

test('the README, the install guide and the release workflow name the same asset URLs', () => {
  const release = readFileSync(resolve('.github/workflows/release.yml'), 'utf8');
  for (const asset of ['install.sh', 'install.ps1', 'tds-factory.tgz']) {
    assert.ok(readme.includes(base + asset) && guide.includes(base + asset), `${asset} URL in both docs`);
  }
  assert.ok(release.includes('scripts/install.sh') && release.includes('scripts/install.ps1'));
});
