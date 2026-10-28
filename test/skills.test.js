import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, symlinkSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../src/install.js';
import { SKILLS_DIR } from '../src/paths.js';

const flow = readFileSync(join(SKILLS_DIR, 'factory', 'SKILL.md'), 'utf8');
const invoked = [...flow.matchAll(/Invoke `([a-z-]+)`/g)].map((m) => m[1]);

test('every skill the factory invokes can be called by the model', () => {
  for (const name of invoked) {
    const skill = readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
    assert.doesNotMatch(skill, /^disable-model-invocation:/m, name);
  }
});

test('install replaces a symlinked skill with a copy', () => {
  const project = mkdtempSync(join(tmpdir(), 'tds-install-'));
  const other = mkdtempSync(join(tmpdir(), 'tds-other-'));
  mkdirSync(join(project, '.claude', 'skills'), { recursive: true });
  const link = join(project, '.claude', 'skills', 'to-spec');
  symlinkSync(other, link);
  const cwd = process.cwd();
  process.chdir(project);
  try {
    install({ agent: 'claude', project: true, force: false });
  } finally {
    process.chdir(cwd);
  }
  assert.ok(!lstatSync(link).isSymbolicLink());
  assert.ok(existsSync(join(link, 'SKILL.md')));
  assert.ok(existsSync(other));
});

test('security-review ships with its reference files', () => {
  const dir = join(SKILLS_DIR, 'security-review');
  assert.ok(existsSync(join(dir, 'SKILL.md')));
  assert.ok(readdirSync(join(dir, 'references')).includes('vuln-categories.md'));
});
