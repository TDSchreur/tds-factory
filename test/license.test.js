import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const read = (file) => readFileSync(resolve(file), 'utf8');

test('the repository has an MIT LICENSE, as package.json says', () => {
  assert.equal(JSON.parse(read('package.json')).license, 'MIT');
  assert.match(read('LICENSE'), /^MIT License\n\nCopyright \(c\) 2026 \S/);
});

test('THIRD-PARTY-NOTICES.md names every upstream source and carries its MIT notice', () => {
  const notices = read('THIRD-PARTY-NOTICES.md');
  const urls = [...read('.gitmodules').matchAll(/url = (\S+)/g)].map((m) => m[1]);
  assert.equal(urls.length, 3);
  for (const url of urls) assert.ok(notices.includes(url), url);
  assert.equal(notices.split('Permission is hereby granted, free of charge').length - 1, urls.length, 'one notice text per upstream');
});

test('the packed tarball carries the license and the third-party notices', () => {
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(packed.status, 0, packed.stderr);
  const info = JSON.parse(packed.stdout); // an array in npm 10 and 11, an object keyed by package name in npm 12
  const files = (Array.isArray(info) ? info[0] : Object.values(info)[0]).files.map((f) => f.path);
  assert.ok(files.includes('LICENSE'), 'LICENSE');
  assert.ok(files.includes('THIRD-PARTY-NOTICES.md'), 'THIRD-PARTY-NOTICES.md');
});

test('the packed tarball carries a complete provenance entry for every synced skill', () => {
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(packed.status, 0, packed.stderr);
  const info = JSON.parse(packed.stdout);
  const files = (Array.isArray(info) ? info[0] : Object.values(info)[0]).files.map((f) => f.path);
  assert.ok(files.includes('skills/PROVENANCE.json'), 'skills/PROVENANCE.json');
  const { skills } = JSON.parse(read('skills/PROVENANCE.json'));
  const synced = readdirSync(resolve('skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(resolve('skills', e.name, '.tds-factory')))
    .map((e) => e.name)
    .sort();
  assert.deepEqual(Object.keys(skills).sort(), synced);
  for (const [name, entry] of Object.entries(skills)) {
    assert.match(entry.commit, /^[0-9a-f]{40}$/, `${name} commit`);
    assert.ok(Array.isArray(entry.transformations), `${name} transformations`);
    for (const field of ['source', 'upstream', 'license', 'attribution']) assert.ok(entry[field], `${name} ${field}`);
    assert.ok(read('THIRD-PARTY-NOTICES.md').includes(entry.upstream), `${name} upstream is in the notices`);
  }
});
