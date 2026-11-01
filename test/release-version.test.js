import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { nextVersion } from '../scripts/next-version.js';

test('the first Release of a minor line starts at patch 0', () => {
  assert.equal(nextVersion('0.1.0', []), '0.1.0');
});
test('the next Release takes the next patch after the highest tag of the line', () => {
  assert.equal(nextVersion('0.1.0', ['v0.1.0', 'v0.1.2', 'v0.1.1']), '0.1.3');
});
test('tags of other minor and major lines and tags that are not versions are ignored', () => {
  assert.equal(nextVersion('0.2.0', ['v0.1.9', 'v1.2.5', 'v0.2', 'latest', 'v0.2.x', 'v0.2.1-beta']), '0.2.0');
  assert.equal(nextVersion('0.1.0', ['v0.1.4', 'v0.10.7', 'v0.11.9']), '0.1.5');
});
test('a raised minor starts again at patch 0 and the patch of package.json does not matter', () => {
  assert.equal(nextVersion('0.3.7', ['v0.2.9']), '0.3.0');
});
test('a base that is not a version is refused', () => {
  assert.throws(() => nextVersion('next', []), /version/);
});
test('the script prints the next version for the workflow', () => {
  const result = spawnSync(process.execPath, [resolve('scripts/next-version.js'), '0.1.0', 'v0.1.0', 'v0.1.1'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '0.1.2\n');
});

// The workflow cannot run here, so check the points that break installs when they change.
const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8');
test('the release workflow runs manually on main and tests before it publishes', () => {
  assert.match(workflow, /on:\s+workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
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
