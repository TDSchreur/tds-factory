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

test('the CI workflow lints both Bootstrap installers with pinned tools and runs install.ps1 on Windows PowerShell 5.1 and 7', () => {
  const shellcheck = ci.slice(ci.indexOf('  shellcheck:'), ci.indexOf('  psscriptanalyzer:'));
  assert.match(shellcheck, /SHELLCHECK_SHA256: [0-9a-f]{64}/, 'the shellcheck download is checksum-verified');
  assert.match(shellcheck, /sha256sum --check/);
  assert.match(shellcheck, /shellcheck-v\d+\.\d+\.\d+\/shellcheck" scripts\/install\.sh/);
  const analyzer = ci.slice(ci.indexOf('  psscriptanalyzer:'), ci.indexOf('  install-windows:'));
  assert.match(analyzer, /Install-Module PSScriptAnalyzer -RequiredVersion \d+\.\d+\.\d+/, 'the analyzer version is pinned');
  assert.match(analyzer, /Invoke-ScriptAnalyzer -Path scripts\/install\.ps1/);
  assert.match(analyzer, /if \(\$findings\) \{ exit 1 \}/, 'findings fail the job');
  const windows = ci.slice(ci.indexOf('  install-windows:'));
  assert.match(windows, /runs-on: windows-latest/);
  assert.match(windows, /REQUIRE_POWERSHELL: 1/);
  assert.match(windows, /INSTALL_PS1_SHELL: powershell\s+run: node --test test\/install-ps1\.test\.js/);
  assert.match(windows, /INSTALL_PS1_SHELL: pwsh\s+run: node --test test\/install-ps1\.test\.js/);
});

test('every third-party action in the CI workflow is pinned to a commit SHA', () => {
  for (const [, ref] of ci.matchAll(/uses: \S+@(\S+)/g)) assert.match(ref, /^[0-9a-f]{40}$/);
});
