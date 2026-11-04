import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pickUnitTests } from '../scripts/repeat-changed-tests.js';

test('only changed unit test files are picked: no browser tests, helpers or other files', () => {
  assert.deepEqual(
    pickUnitTests([
      'test/run-events.test.js',
      'test/dashboard-page-browser.test.js',
      'test/wait-until.js',
      'src/run-events.js',
      'test/sub/nested.test.js',
      'docs/development.md',
      'test/update.test.js',
    ]),
    ['test/run-events.test.js', 'test/update.test.js'],
  );
});

test('a path with Windows separators is still found', () => {
  assert.deepEqual(pickUnitTests(['test\\update.test.js']), ['test/update.test.js']);
});

test('with no changed unit test the script succeeds without running anything', () => {
  const result = spawnSync(process.execPath, ['scripts/repeat-changed-tests.js', '--files', 'src/a.js', 'README.md'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /no changed unit test/i);
});
