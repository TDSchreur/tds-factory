import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// With no PATH there is no browser. Reports what openPage does about it.
const withoutBrowser = (env) => spawnSync(process.execPath, ['--input-type=module', '-e', `
  import { openPage } from './test/browser.js';
  const t = { skip: () => console.log('skipped') };
  try { await openPage(t, {}); } catch (err) { console.log('threw: ' + err.message); }
`], { encoding: 'utf8', env: { PATH: '', ...env } });

test('browser tests skip without a browser, and fail when REQUIRE_BROWSER is set', () => {
  assert.match(withoutBrowser({}).stdout, /^skipped/);
  assert.match(withoutBrowser({ REQUIRE_BROWSER: '1' }).stdout, /^threw: .*REQUIRE_BROWSER/);
});

// The workflow cannot run here, so check the points that make it protect pull requests.
const ci = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
test('the CI workflow tests every pull request on the latest LTS Node', () => {
  assert.match(ci, /on:\s+pull_request:/);
  assert.match(ci, /node-version: lts\/\*/);
  assert.match(ci, /run: npm test/);
  assert.match(ci, /permissions:\s+contents: read/);
});
test('the CI browser job requires a browser instead of skipping', () => {
  const browser = ci.slice(ci.indexOf('browser:'));
  assert.match(browser, /REQUIRE_BROWSER: 1/);
  assert.match(browser, /GITHUB_PATH/);
  assert.match(browser, /run: npm test/);
});
