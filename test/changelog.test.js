import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFragment, release } from '../scripts/changelog.js';

const root = (changelog, fragments = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'changelog-'));
  mkdirSync(join(dir, 'changelog.d'));
  writeFileSync(join(dir, 'CHANGELOG.md'), changelog);
  writeFileSync(join(dir, 'changelog.d', 'README.md'), '# Fragments\n');
  for (const [name, text] of Object.entries(fragments)) writeFileSync(join(dir, 'changelog.d', name), text);
  return dir;
};
const HEAD = '# Changelog\n\n## [Unreleased]\n\n';
const OLD = '## [0.1.0] - 2026-01-01\n\n### Added\n- First.\n';

test('release groups fragments and [Unreleased] entries by category in Keep a Changelog order', () => {
  const dir = root(`${HEAD}### Fixed\n- Old fix.\n\n${OLD}`, { 'a.md': '### Fixed\n- Fix A.\n\n### Added\n- Add A.\n', 'b.md': '### Changed\n- Change B.\n  continued.\n\n### Added\n- Add B.\n' });
  assert.deepEqual(release({ root: dir, version: '0.2.0', date: '2026-02-02' }), ['a.md', 'b.md']);
  assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), `${HEAD}## [0.2.0] - 2026-02-02\n\n### Added\n- Add A.\n- Add B.\n\n### Changed\n- Change B.\n  continued.\n\n### Fixed\n- Old fix.\n- Fix A.\n\n${OLD}`);
});
test('release deletes the fragments but keeps the README', () => {
  const dir = root(`${HEAD}${OLD}`, { 'a.md': '### Added\n- A.\n' });
  release({ root: dir, version: '0.2.0', date: '2026-02-02' });
  assert.deepEqual(readdirSync(join(dir, 'changelog.d')), ['README.md']);
});
test('release refuses a malformed fragment and changes nothing', () => {
  const dir = root(`${HEAD}${OLD}`, { 'a.md': '### Added\n- A.\n', 'bad.md': '### Invented\n- X.\n' });
  assert.throws(() => release({ root: dir, version: '0.2.0', date: '2026-02-02' }), /bad\.md: unknown heading/);
  assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), `${HEAD}${OLD}`);
  assert.ok(existsSync(join(dir, 'changelog.d', 'a.md')));
});
test('release refuses an existing version, a bad version or date, and nothing to release', () => {
  assert.throws(() => release({ root: root(`${HEAD}${OLD}`, { 'a.md': '### Added\n- A.\n' }), version: '0.1.0', date: '2026-02-02' }), /already has a section/);
  assert.throws(() => release({ root: root(`${HEAD}${OLD}`), version: 'next', date: '2026-02-02' }), /not a version/);
  assert.throws(() => release({ root: root(`${HEAD}${OLD}`), version: '0.2.0', date: 'today' }), /not a date/);
  assert.throws(() => release({ root: root(`${HEAD}${OLD}`), version: '0.2.0', date: '2026-02-02' }), /nothing to release/);
});
test('a fragment needs a known heading over at least one entry', () => {
  assert.throws(() => parseFragment('- loose\n', 'f'), /expected a "### Category" heading/);
  assert.throws(() => parseFragment('### Added\n', 'f'), /no entries/);
  assert.deepEqual(parseFragment('### Added\n- A.\n'), { Added: ['- A.'] });
});
test('every fragment in changelog.d is valid, so the release step cannot fail on one', () => {
  for (const name of readdirSync('changelog.d').filter((n) => n.endsWith('.md') && n !== 'README.md')) parseFragment(readFileSync(join('changelog.d', name), 'utf8'), `changelog.d/${name}`);
});
