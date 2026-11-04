import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// With no PATH there is no browser. Reports what openPage does about it.
/** @param {NodeJS.ProcessEnv} env */
const withoutBrowser = (env) =>
  spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
  import { openPage } from './test/browser.js';
  const t = { skip: () => console.log('skipped') };
  try { await openPage(t, {}); } catch (err) { console.log('threw: ' + err.message); }
`,
    ],
    { encoding: 'utf8', env: { PATH: '', ...env } },
  );

test('browser tests skip without a browser, and fail when REQUIRE_BROWSER is set', () => {
  assert.match(withoutBrowser({}).stdout, /^skipped/);
  // Windows never runs the browser tests, so REQUIRE_BROWSER cannot fail there.
  const required = process.platform === 'win32' ? /^skipped/ : /^threw: .*REQUIRE_BROWSER/;
  assert.match(withoutBrowser({ REQUIRE_BROWSER: '1' }).stdout, required);
});

// The workflow cannot run here, so check the points that make it protect pull requests.
const ci = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
test('the CI workflow tests every pull request with read-only permissions', () => {
  assert.match(ci, /on:\s+pull_request:/);
  assert.match(ci, /node-version: lts\/\*/);
  assert.match(ci, /run: npm run test:unit/);
  assert.match(ci, /permissions:\s+contents: read/);
});
test('the CI browser job requires a browser instead of skipping', () => {
  const browser = ci.slice(ci.indexOf('browser:'));
  assert.match(browser, /REQUIRE_BROWSER: 1/);
  assert.match(browser, /GITHUB_PATH/);
  assert.match(browser, /run: npm run test:browser/);
});

test('the CI workflow lints every shell and PowerShell script with pinned tools', () => {
  const shellcheck = ci.slice(ci.indexOf('  shellcheck:'), ci.indexOf('  psscriptanalyzer:'));
  assert.match(shellcheck, /SHELLCHECK_SHA256: [0-9a-f]{64}/, 'the shellcheck download is checksum-verified');
  assert.match(shellcheck, /sha256sum --check/);
  assert.match(shellcheck, /shellcheck-v\d+\.\d+\.\d+\/shellcheck" scripts\/\*\.sh/);
  const analyzer = ci.slice(ci.indexOf('  psscriptanalyzer:'), ci.indexOf('  # One stable name'));
  assert.match(
    analyzer,
    /Install-Module PSScriptAnalyzer -RequiredVersion \d+\.\d+\.\d+/,
    'the analyzer version is pinned',
  );
  assert.match(analyzer, /Invoke-ScriptAnalyzer -Path scripts -Recurse/);
  assert.match(analyzer, /if \(\$findings\) \{ exit 1 \}/, 'findings fail the job');
});

test('every third-party action in the CI workflow is pinned to a commit SHA', () => {
  for (const [, ref] of ci.matchAll(/uses: \S+@(\S+)/g)) assert.match(ref, /^[0-9a-f]{40}$/);
});

test('no CI job runs on Windows, and ci-ok needs only jobs that exist', () => {
  assert.doesNotMatch(ci, /windows/i);
  const needs = /needs: \[([^\]]+)\]/.exec(ci.slice(ci.indexOf('  ci-ok:')));
  assert.ok(needs);
  for (const job of needs[1].split(',').map((name) => name.trim())) assert.match(ci, new RegExp(`^  ${job}:`, 'm'));
});

test('CI and release test only the active LTS lines, matching engines', () => {
  const release = readFileSync('.github/workflows/release.yml', 'utf8');
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const engines = JSON.parse(readFileSync('package.json', 'utf8')).engines.node;
  assert.equal(engines, '>=24.4');
  for (const file of [workflow, release]) assert.match(file, /node: \['24\.4', 'lts\/\*'\]/);
});
