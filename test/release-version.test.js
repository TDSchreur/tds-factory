import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The workflow cannot run here, so check the points that break installs when they change.
const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8');
test('the release workflow runs when main changes, takes its version from package.json and tests before it publishes', () => {
  assert.match(workflow, /push:\s+branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /require\('\.\/package\.json'\)\.version/);
  assert.doesNotMatch(workflow, /npm version/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /needs: \[verify, browser\]/, 'publication waits for verification jobs');
  assert.ok(
    workflow.indexOf('npm run test:package -- tds-factory.tgz') < workflow.indexOf('gh release create'),
    'the published asset is tested before release',
  );
});
test('the release workflow publishes tds-factory.tgz as the latest Release, serialized and without committing', () => {
  assert.match(workflow, /gh release create .*tds-factory\.tgz/);
  assert.match(workflow, /--latest/);
  assert.match(workflow, /concurrency:\s+group: release\s+cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /git (commit|push)/);
});

const ASSETS = ['tds-factory.tgz', 'tds-factory.tgz.sha256', 'install.sh', 'install.ps1'];
const latestWorkflow = readFileSync(resolve('.github/workflows/latest-release.yml'), 'utf8');

test('the release workflow attaches the tarball, its checksum and both installers in the call that creates the Release', () => {
  assert.match(
    workflow,
    /gh release create "v\$VERSION" tds-factory\.tgz tds-factory\.tgz\.sha256 scripts\/install\.sh scripts\/install\.ps1 /,
  );
});

test('the release workflow checks that every published asset URL serves the file it built', () => {
  const check = workflow.slice(workflow.indexOf('Check that the install URLs'));
  assert.ok(
    workflow.indexOf('Check that the install URLs') > workflow.indexOf('gh release create'),
    'the check comes after publishing',
  );
  for (const asset of ASSETS) assert.ok(check.includes(asset), `${asset} is checked`);
  assert.match(check, /releases\/latest\/download\/\$name/);
  assert.match(check, /cmp "\$file" downloaded/);
  assert.match(check, /sha256sum --check tds-factory\.tgz\.sha256/);
});

test('a scheduled workflow fails when the latest Release lacks any of the four assets', () => {
  assert.match(latestWorkflow, /schedule:/);
  assert.match(latestWorkflow, /release:\s+types:/);
  for (const asset of ASSETS) assert.ok(latestWorkflow.includes(asset), `${asset} is checked`);
  assert.match(latestWorkflow, /permissions:\s+contents: read/);
});

test('the release guide lists the four assets of a Release', () => {
  const guide = readFileSync(resolve('docs/releasing.md'), 'utf8');
  for (const asset of ASSETS) assert.ok(guide.includes(asset), `${asset} is listed`);
});
