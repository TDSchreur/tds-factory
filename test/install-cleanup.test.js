import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './git-repo.js';
import { hashLine } from '../src/tree-hash.js';
import { cleanupDestination } from '../src/install-cleanup.js';

function fixture() {
  const root = tempDir('install-cleanup-');
  const skillsDir = path.join(root, 'skills');
  const agentsDir = path.join(root, 'agents');
  const backupRoot = path.join(root, 'backups');
  fs.mkdirSync(skillsDir);
  fs.mkdirSync(agentsDir);
  /** @type {string[]} */
  const output = [];
  return { root, skillsDir, agentsDir, backupRoot, log: (/** @type {string} */ line) => output.push(line), output };
}

/** @param {ReturnType<typeof fixture>} f @param {string} name */
function skill(f, name = 'factory') {
  const dir = path.join(f.skillsDir, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), 'original skill\n');
  fs.writeFileSync(path.join(dir, '.tds-factory'), hashLine(dir));
  return dir;
}

test('cleanup removes marked skills and preserves unrelated files, including on retry', () => {
  const f = fixture();
  const owned = skill(f);
  fs.mkdirSync(path.join(f.skillsDir, 'my-skill'));
  fs.writeFileSync(path.join(f.skillsDir, 'notes.txt'), 'mine');
  cleanupDestination(f);
  assert.equal(fs.existsSync(owned), false);
  assert.equal(fs.existsSync(path.join(f.skillsDir, 'my-skill')), true);
  assert.equal(fs.readFileSync(path.join(f.skillsDir, 'notes.txt'), 'utf8'), 'mine');
  assert.equal(fs.existsSync(f.backupRoot), false);
  assert.doesNotThrow(() => cleanupDestination(f));
});

test('cleanup backs up every edit and legacy marked folder before removal', () => {
  const f = fixture();
  const edited = skill(f);
  fs.writeFileSync(path.join(edited, 'SKILL.md'), 'my changes');
  fs.mkdirSync(path.join(edited, 'nested'));
  fs.writeFileSync(path.join(edited, 'nested', 'personal.txt'), 'keep this');
  const legacy = skill(f, 'old-skill');
  fs.writeFileSync(path.join(legacy, '.tds-factory'), 'installed by old factory\n');
  const result = cleanupDestination(f);
  assert.ok(result.backupDir);
  assert.equal(fs.readFileSync(path.join(result.backupDir, 'skills/factory/SKILL.md'), 'utf8'), 'my changes');
  assert.equal(fs.readFileSync(path.join(result.backupDir, 'skills/factory/nested/personal.txt'), 'utf8'), 'keep this');
  assert.equal(
    fs.readFileSync(path.join(result.backupDir, 'skills/old-skill/.tds-factory'), 'utf8'),
    'installed by old factory\n',
  );
  assert.deepEqual(fs.readdirSync(f.skillsDir), []);
});

test('dry-run reports backups and removal without creating or changing files', () => {
  const f = fixture();
  const dir = skill(f);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), 'edited');
  cleanupDestination({ ...f, dryRun: true });
  assert.equal(fs.existsSync(f.backupRoot), false);
  assert.equal(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), 'edited');
  assert.ok(f.output.some((line) => line.startsWith('would back up')));
  assert.ok(f.output.some((line) => line.startsWith('would remove')));
});

test('backup failure preserves edited and unedited originals', () => {
  const f = fixture();
  const edited = skill(f);
  const pristine = skill(f, 'pristine');
  fs.writeFileSync(path.join(edited, 'SKILL.md'), 'edited');
  fs.writeFileSync(f.backupRoot, 'a file cannot hold backups');
  assert.throws(() => cleanupDestination(f));
  assert.equal(fs.readFileSync(path.join(edited, 'SKILL.md'), 'utf8'), 'edited');
  assert.equal(fs.existsSync(pristine), true);
});

test('separate cleanup operations use distinct recoverable backup directories', () => {
  const f = fixture();
  const a = skill(f);
  fs.writeFileSync(path.join(a, '.tds-factory'), 'legacy');
  const first = cleanupDestination(f).backupDir;
  const b = skill(f);
  fs.writeFileSync(path.join(b, '.tds-factory'), 'legacy');
  const second = cleanupDestination(f).backupDir;
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first, second);
  assert.equal(fs.readFileSync(path.join(first, 'skills/factory/SKILL.md'), 'utf8'), 'original skill\n');
});

test('missing destinations need no writes', () => {
  const f = fixture();
  fs.rmdirSync(f.skillsDir);
  fs.rmdirSync(f.agentsDir);
  assert.doesNotThrow(() => cleanupDestination(f));
  assert.equal(fs.existsSync(f.skillsDir), false);
  assert.equal(fs.existsSync(f.backupRoot), false);
});

const symlinkOptions = process.platform === 'win32' ? { skip: 'symlinks require Windows privileges' } : {};

test('cleanup rejects symlink ancestors and ownership markers before deleting any skill', symlinkOptions, () => {
  for (const where of ['ancestor', 'destination', 'marker']) {
    const f = fixture();
    const dir = skill(f);
    const outside = path.join(f.root, 'external');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'sentinel'), 'untouched');
    if (where === 'marker') {
      fs.unlinkSync(path.join(dir, '.tds-factory'));
      fs.symlinkSync(path.join(outside, 'sentinel'), path.join(dir, '.tds-factory'));
      assert.throws(() => cleanupDestination(f), /symbolic link/);
    } else {
      const link = path.join(f.root, 'link');
      fs.symlinkSync(where === 'ancestor' ? f.root : f.skillsDir, link);
      assert.throws(
        () => cleanupDestination({ ...f, skillsDir: where === 'ancestor' ? path.join(link, 'skills') : link }),
        /symbolic link/,
      );
    }
    assert.equal(fs.existsSync(dir), true);
    assert.equal(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8'), 'untouched');
  }
});

test('cleanup preserves symlink skill entries and backs up nested links without following them', symlinkOptions, () => {
  const f = fixture();
  const dir = skill(f);
  const outside = path.join(f.root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'sentinel'), 'untouched');
  fs.symlinkSync(outside, path.join(f.skillsDir, 'linked-skill'));
  fs.symlinkSync(outside, path.join(dir, 'linked-data'));
  const result = cleanupDestination(f);
  assert.ok(result.backupDir);
  assert.equal(fs.lstatSync(path.join(result.backupDir, 'skills/factory/linked-data')).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(f.skillsDir, 'linked-skill')).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8'), 'untouched');
});

test('backup paths inside a destination or through a symlink are rejected before mutation', symlinkOptions, () => {
  const f = fixture();
  const dir = skill(f);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), 'edited');
  assert.throws(() => cleanupDestination({ ...f, backupRoot: path.join(dir, 'backup') }), /overlap/);
  fs.symlinkSync(f.root, f.backupRoot);
  assert.throws(() => cleanupDestination(f), /symbolic link/);
  assert.equal(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), 'edited');
});
